/**
 * From staged to on chain — the owner's transactions, prepared by us.
 *
 * Everything the app learns and every grant it makes is staged first: bytes on
 * IPFS, records in the local network directory. Nothing reaches the owner's
 * name until they sign, from the review screen. This module works out what to
 * sign next and hands back calldata; it never holds a key that could send it.
 *
 * Revokes are the exception to "batch it later". Until the chain's access
 * record changes, the chain still lists the revoked agent's sealed key, so the
 * interface asks for that signature at once rather than queueing it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createPublicClient, http, namehash, type Address, type Hex, type PublicClient } from 'viem'
import { sepolia } from 'viem/chains'
import { abis, decodeObject, findOwner, findResolver, planBatch, planNext, PlanError, type Batch, type Deployed, type Plan, type Staged, type Step } from '@knowledge01/core'
import { Repository } from '@knowledge01/repo'
import type { AccessManifest } from '@knowledge01/repo'
import { appNetwork, ensureOwnerGrant, namespacesOf, publishNamespace, readOwnerKey } from './sharing.js'
import { cacheRoot } from './cacheRoot.js'

const RPC = () => process.env.SEPOLIA_RPC_URL?.trim() || 'https://ethereum-sepolia-rpc.publicnode.com'
let client: PublicClient | null = null
export const chainClient = (): PublicClient => (client ??= createPublicClient({ chain: sepolia, transport: http(RPC()) }) as PublicClient)

/** The root name every namespace hangs under: `food.you.eth` → `you.eth`. */
export const rootOf = (owner: string): string => owner.split('.').slice(-2).join('.')

const stateRoot = (): string => {
  return cacheRoot()
}
const deployedPath = (root: string) => join(stateRoot(), 'onchain', `${root}.json`)
const readDeployed = (root: string): Deployed => {
  try { return existsSync(deployedPath(root)) ? (JSON.parse(readFileSync(deployedPath(root), 'utf8')) as Deployed) : {} } catch { return {} }
}
function recordDeploy(root: string, step: Step): void {
  if (!step.deploys) return
  // The address is a prediction until the transaction lands; the planner only
  // links a recorded address once it has code, and settleDeploys waits for that.
  const cur = readDeployed(root)
  const d = step.deploys.name
    ? { ...cur, registries: { ...(cur.registries ?? {}), [step.deploys.name]: step.deploys.address }, pendingAt: Date.now() }
    : { ...cur, [step.deploys.role]: step.deploys.address, pendingAt: Date.now() }
  mkdirSync(dirname(deployedPath(root)), { recursive: true })
  writeFileSync(deployedPath(root), JSON.stringify(d, null, 2))
}

/** What each namespace's records say locally, i.e. what the chain should say after the next publish. */
export async function stagedOf(owner: string): Promise<Staged[]> {
  const net = appNetwork()
  return Promise.all(namespacesOf(owner).map(async (name) => {
    const r = net.records(name)
    const [contenthash, access] = await Promise.all([r.read(), r.readText('knowledge.access')])
    return { name, contenthash, access }
  }))
}

/**
 * Make sure every namespace is staged at its latest version, sealed to the
 * owner's key if they have one. Idempotent: an up-to-date namespace costs a
 * read and nothing else.
 */
export async function stageAll(owner: string): Promise<Staged[]> {
  const hasKey = !!readOwnerKey(owner)
  for (const ns of namespacesOf(owner)) {
    if (hasKey) await ensureOwnerGrant(Repository.open(ns), owner)
    await publishNamespace(ns)
  }
  return stagedOf(owner)
}

/**
 * A contract deployed a moment ago can read as empty from a load-balanced RPC
 * for a few seconds. Planning in that window would either fail the next step's
 * simulation or deploy a second copy, so wait until what was recorded as
 * deployed actually has code.
 */
async function settleDeploys(root: string): Promise<void> {
  const d = readDeployed(root) as Deployed & { pendingAt?: number }
  // Only a deploy issued in the last few minutes can still be landing; an
  // older recorded address with no code was never sent, and waiting on it
  // would slow every publish for nothing.
  if (!d.pendingAt || Date.now() - d.pendingAt > 5 * 60_000) return
  for (const address of [d.resolver, d.registry, ...Object.values(d.registries ?? {})]) {
    if (!address) continue
    for (let i = 0; i < 12; i++) {
      const code = await chainClient().getCode({ address }).catch(() => undefined)
      if (code && code !== '0x') break
      await new Promise((r) => setTimeout(r, 2500))
    }
  }
}

/** The next transaction for this wallet, or null when the chain is current. */
export async function nextChainStep(owner: string, wallet: Address, opts: { stage?: boolean } = {}): Promise<Plan> {
  const root = rootOf(owner)
  const staged = opts.stage ? await stageAll(owner) : await stagedOf(owner)
  await settleDeploys(root)
  // A step that fails its simulation right after the previous one landed is
  // usually the RPC catching up, not a real revert: give it a few tries.
  let last: unknown
  for (let i = 0; i < 4; i++) {
    try {
      const plan = await planNext(chainClient(), { root, owner: wallet, staged: staged.filter((s) => s.contenthash), deployed: readDeployed(root) })
      if (plan.step) recordDeploy(root, plan.step)
      return plan
    } catch (e) {
      last = e
      await new Promise((r) => setTimeout(r, 3000))
    }
  }
  throw last
}

export type ChainStatus =
  | { ok: true; plan: Plan; revokedStillOnChain: { namespace: string; agents: string[] }[] }
  | { ok: false; reason: string }

/**
 * How far the chain is behind, for pages that show it without a wallet.
 *
 * Plans as the name's on-chain owner, which is who would have to sign anyway.
 */
export async function chainStatus(owner: string): Promise<ChainStatus> {
  try {
    const root = rootOf(owner)
    const wallet = await findOwner(chainClient(), root)
    if (BigInt(wallet) === 0n) return { ok: false, reason: `${root} is not registered on Sepolia` }
    // Every namespace, staged or not: one that has never been uploaded still
    // needs registering, and that belongs in the count of what is ahead.
    const staged = await stagedOf(owner)
    const plan = await planNext(chainClient(), { root, owner: wallet, staged, deployed: readDeployed(root) })
    return { ok: true, plan, revokedStillOnChain: await revokedStillOnChain(plan, staged) }
  } catch (e) {
    return { ok: false, reason: e instanceof PlanError || e instanceof Error ? e.message : String(e) }
  }
}

/** Agents the chain still lists for a namespace after they were revoked locally. */
async function revokedStillOnChain(plan: Plan, staged: Staged[]): Promise<{ namespace: string; agents: string[] }[]> {
  const net = appNetwork()
  const read = async (cid: string | null) => {
    if (!cid) return null
    try { return decodeObject<AccessManifest>(await net.storage.get({ kind: net.storage.kind, ref: cid }, { plaintext: true })) } catch { return null }
  }
  const out: { namespace: string; agents: string[] }[] = []
  for (const n of plan.namespaces) {
    const s = staged.find((x) => x.name === n.name)
    if (!n.access || n.access === s?.access) continue
    const [onChain, local] = await Promise.all([read(n.access), read(s?.access ?? null)])
    const keep = new Set((local?.grants ?? []).map((g) => g.id))
    const gone = (onChain?.grants ?? []).filter((g) => !g.owner && !keep.has(g.id)).map((g) => g.agent)
    if (gone.length) out.push({ namespace: n.name, agents: gone })
  }
  return out
}

/** Wait for a transaction the owner sent, and say whether it worked. */
export async function waitForTx(hash: Hex): Promise<{ ok: boolean; block: string }> {
  const r = await chainClient().waitForTransactionReceipt({ hash, timeout: 180_000 })
  return { ok: r.status === 'success', block: r.blockNumber.toString() }
}

/**
 * A namespace's records as a reader would find them: on chain when the owner
 * has published, the staged copy otherwise — and which one it was.
 */
export async function publicRecords(namespace: string): Promise<{ namespace: string; source: 'chain' | 'staged'; contenthash: Hex | null; refsCid: string | null; access: string | null }> {
  const net = appNetwork()
  try {
    const { resolver } = await findResolver(chainClient(), namespace)
    if (BigInt(resolver) !== 0n) {
      const node = namehash(namespace)
      const [ch, access] = await Promise.all([
        chainClient().readContract({ address: resolver, abi: abis.resolver, functionName: 'contenthash', args: [node] }) as Promise<Hex>,
        chainClient().readContract({ address: resolver, abi: abis.resolver, functionName: 'text', args: [node, 'knowledge.access'] }) as Promise<string>,
      ])
      if (ch && ch !== '0x') return { namespace, source: 'chain', contenthash: ch, refsCid: net.storage.fromContenthash(ch).ref, access: access || null }
    }
  } catch { /* not on chain: fall through to what is staged */ }
  const r = net.records(namespace)
  const [contenthash, access] = await Promise.all([r.read(), r.readText('knowledge.access')])
  return { namespace, source: 'staged', contenthash, refsCid: contenthash ? net.storage.fromContenthash(contenthash).ref : null, access }
}

// ---------------------------------------------------------------------------
// What is waiting to be published
// ---------------------------------------------------------------------------

export type PendingCommit = {
  id: string
  version: number
  message: string
  at: string
  added: { id: string; claim: string; sources: string[]; confidence: number }[]
  updated: number
  removed: number
}

export type NamespacePending = {
  namespace: string
  /** The version your ENS name points at, or null if it points at nothing yet. */
  onChain: { version: number; commit: string } | null
  /** Local commits on main the chain does not have, newest first. */
  commits: PendingCommit[]
  /** Staged access record differs from the one on chain. */
  accessChanged: boolean
}

/**
 * Per namespace, what the chain does not have yet.
 *
 * Read from the chain rather than remembered: the name's contenthash points at
 * a refs object on IPFS, which this app can decrypt with the namespace key, and
 * the commit it names is where "published" stops. Everything after that on
 * main is pending.
 */
export async function pendingOf(owner: string): Promise<NamespacePending[]> {
  const net = appNetwork()
  const out: NamespacePending[] = []
  for (const namespace of namespacesOf(owner)) {
    const repo = Repository.open(namespace)
    const [rec, staged] = await Promise.all([
      publicRecords(namespace).catch(() => null),
      net.records(namespace).readText('knowledge.access').catch(() => null),
    ])

    let chainCommit: string | null = null
    if (rec?.source === 'chain' && rec.refsCid) {
      try {
        const cfg = repo.store.readConfig()
        const as = repo.policy.readers === 'public' || !cfg.contentKey
          ? { plaintext: true as const }
          : { contentKey: Uint8Array.from(Buffer.from(cfg.contentKey.replace(/^0x/, ''), 'hex')) }
        const refs = decodeObject<{ head: string; branches: Record<string, string> }>(await net.storage.get({ kind: net.storage.kind, ref: rec.refsCid }, as))
        chainCommit = refs.branches[refs.head] ?? null
      } catch { chainCommit = null }
    }

    const line = repo.log(repo.refs.head, 10_000) // newest first
    const total = line.length
    const commits: PendingCommit[] = []
    for (let i = 0; i < line.length; i++) {
      const c = line[i]!
      if (c.id === chainCommit) break
      const before = line[i + 1]?.snapshot ?? {}
      commits.push({
        id: c.id,
        version: total - i,
        message: c.message,
        at: c.timestamp,
        added: c.changes.added.map((id) => c.snapshot[id]).filter((k): k is NonNullable<typeof k> => !!k && !before[k.id]).map((k) => ({
          id: k.id, claim: k.claim, sources: k.sources.map((s) => s.name ?? s.type), confidence: k.confidence,
        })),
        updated: c.changes.updated.length,
        removed: c.changes.removed.length,
      })
    }
    const onChainIndex = chainCommit ? line.findIndex((c) => c.id === chainCommit) : -1
    out.push({
      namespace,
      onChain: onChainIndex >= 0 ? { version: total - onChainIndex, commit: chainCommit! } : null,
      commits,
      accessChanged: rec?.source === 'chain' ? (rec.access ?? null) !== (staged ?? null) : !!staged,
    })
  }
  return out
}


/**
 * Everything still needed, as one batch the wallet can confirm once.
 *
 * Stages first (bytes to IPFS, records locally), then builds every call. The
 * deploys' future addresses are recorded like the step-by-step path does, so a
 * batch that is declined or fails falls back to that path without deploying
 * twice.
 */
export async function chainBatch(owner: string, wallet: Address): Promise<Batch> {
  const root = rootOf(owner)
  const staged = await stageAll(owner)
  const batch = await planBatch(chainClient(), { root, owner: wallet, staged: staged.filter((s) => s.contenthash), deployed: readDeployed(root) })
  // Record every contract the batch will deploy, nested names' registries too.
  for (const c of batch.calls) {
    if (c.deploys) recordDeploy(root, { kind: c.kind, label: c.label, to: c.to, data: c.data, deploys: c.deploys })
  }
  return batch
}
