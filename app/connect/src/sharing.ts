/**
 * Sharing a person's namespaces with agents that are not this app.
 *
 * This app is Agent A: it reads sources and writes claims. Everything here is
 * about the moment those claims leave it — published to the network, with the
 * namespace's key sealed to each agent the owner allows. After that, reading
 * them needs the network and the agent's own key, and nothing of ours.
 *
 * The network is a directory that neither this app nor any agent owns
 * (`~/.knowledge-network`, see `localNetworkDir`). It stands in for IPFS and an
 * ENSv2 resolver, holding exactly the objects and records those would, and it
 * survives `pnpm reset:local` the way IPFS survives a company closing.
 *
 * Why not Sepolia here: a grant is a text record on the name, and on chain only
 * the name's owner can write it. The host does not own a visitor's name, so
 * writing grants on chain has to be the visitor's own transaction. Until the
 * browser signs those, the interface says the network is local rather than
 * implying the grant is on chain.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { cacheRoot } from './cacheRoot.js'
import {
  AccessDenied, NotPublished, Remote, RepoStore, Repository, grantAccess, localNetwork, localNetworkDir,
  readManifest, reposDir, resolveNamespace, revokeAccess,
  type AccessGrant, type AccessManifest, type AccessRole, type Network, type ResolvedNamespace,
} from '@knowledge01/repo'
import type { Hex } from 'viem'
import { encodeObject } from '@knowledge01/core'
import { createStorage } from '@knowledge01/storage'

let cached: { key: string; net: Network } | null = null

/**
 * Where the bytes go: real IPFS when Pinata is configured, otherwise the local
 * directory. Records are always staged locally first — only the owner's wallet
 * can write them to the chain, and it does so from the review screen.
 */
export const bytesHome = (): string =>
  process.env.PINATA_JWT?.trim() && process.env.PINATA_GATEWAY?.trim() ? `ipfs:${process.env.PINATA_GATEWAY!.trim()}` : `local:${localNetworkDir()}`

/** The network this app publishes to. */
export function appNetwork(): Network {
  const dir = localNetworkDir()
  const key = `${dir}|${bytesHome()}`
  if (!cached || cached.key !== key) {
    cached = { key, net: localNetwork(dir, bytesHome().startsWith('ipfs:') ? { storage: createStorage('pinata') } : {}) }
  }
  return cached.net
}

export const networkLabel = (): { kind: string; where: string; bytes: string } => ({
  kind: 'staged records',
  where: localNetworkDir(),
  bytes: bytesHome().startsWith('ipfs:') ? 'IPFS (Pinata)' : 'this machine only',
})

/**
 * Bytes pushed under one home are not in another. A namespace whose last push
 * went elsewhere is re-pushed in full, and its manifest carried across, before
 * anything new is written on top of it.
 */
const homesPath = () => join(stateRoot(), 'bytes-home.json')
async function ensureHome(repo: Repository): Promise<void> {
  const homes = existsSync(homesPath()) ? (JSON.parse(readFileSync(homesPath(), 'utf8')) as Record<string, string>) : {}
  const here = bytesHome()
  const was = homes[repo.namespace]
  if (was === here) return
  const refs = repo.store.readRefs()
  if (Object.keys(refs.objects).length) {
    const old = was?.startsWith('local:') || !was ? localNetwork(localNetworkDir()) : null
    const manifest = old ? await readManifest(old, repo.namespace).catch(() => null) : null
    refs.objects = {}
    repo.store.writeRefs(refs)
    await new Remote(repo, appNetwork().storage, appNetwork().records(repo.namespace)).push()
    if (manifest) {
      const ref = await appNetwork().storage.put(encodeObject(manifest), { collection: repo.namespace, plaintext: true })
      await appNetwork().records(repo.namespace).writeText('knowledge.access', ref.ref)
    }
  }
  homes[repo.namespace] = here
  mkdirSync(dirname(homesPath()), { recursive: true })
  writeFileSync(homesPath(), JSON.stringify(homes, null, 2))
}

// ---------------------------------------------------------------------------
// The owner's recovery key — public half only
// ---------------------------------------------------------------------------

const stateRoot = (): string => {
  return cacheRoot()
}
const ownerKeyPath = (owner: string) => join(stateRoot(), 'owner-keys', `${owner}.json`)

export type OwnerKey = { pubkey: Hex; address?: string; at: string }

/**
 * The public half of the owner's wallet-derived key.
 *
 * The browser derives the private half from a signature and never sends it.
 * Losing this file loses nothing: the owner can sign again and get the same
 * key, and the grants already on the network are sealed to it.
 */
export function readOwnerKey(owner: string): OwnerKey | null {
  const p = ownerKeyPath(owner)
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, 'utf8')) as OwnerKey } catch { return null }
}

export function writeOwnerKey(owner: string, key: { pubkey: Hex; address?: string }): OwnerKey {
  if (!/^0x04[0-9a-fA-F]{128}$/.test(key.pubkey)) throw new Error('owner key must be an uncompressed secp256k1 public key')
  const stored: OwnerKey = { pubkey: key.pubkey.toLowerCase() as Hex, ...(key.address ? { address: key.address } : {}), at: new Date().toISOString() }
  mkdirSync(dirname(ownerKeyPath(owner)), { recursive: true })
  writeFileSync(ownerKeyPath(owner), JSON.stringify(stored, null, 2), { mode: 0o600 })
  return stored
}

// ---------------------------------------------------------------------------
// Namespaces and their access
// ---------------------------------------------------------------------------

/** Namespaces this owner has, on this machine: the root name and every subname under it. */
export function namespacesOf(owner: string): string[] {
  const dir = reposDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((d) => (d === owner || d.endsWith(`.${owner}`)) && RepoStore.exists(join(dir, d)))
    .sort()
}

export type NamespaceAccess = {
  namespace: string
  /** Committed version in this app. */
  version: number
  /** What the network holds: null if it has never been published. */
  published: { version: number; at: string; contenthash: Hex } | null
  /** True when this app has commits the network does not. */
  behind: boolean
  encrypted: boolean
  claims: number
  manifest: AccessManifest | null
  grants: AccessGrant[]
}

export async function accessOf(namespace: string): Promise<NamespaceAccess> {
  const repo = Repository.open(namespace)
  const net = appNetwork()
  const [contenthash, manifest] = await Promise.all([net.records(namespace).read(), readManifest(net, namespace).catch(() => null)])
  const last = repo.store.readConfig().publish?.lastPublish
  const version = repo.version(repo.refs.head)
  const published = contenthash && last?.contenthash === contenthash ? { version: last.version, at: last.at, contenthash } : contenthash ? { version: 0, at: '', contenthash } : null
  return {
    namespace,
    version,
    published,
    behind: !published || published.version < version,
    encrypted: repo.policy.readers !== 'public',
    claims: Object.keys(repo.headSnapshot(repo.refs.head)).length,
    manifest,
    grants: manifest?.grants ?? [],
  }
}

/** Publish every commit this app has for a namespace to the network. */
export async function publishNamespace(namespace: string): Promise<void> {
  const repo = Repository.open(namespace)
  await ensureHome(repo)
  await new Remote(repo, appNetwork().storage, appNetwork().records(namespace)).push()
}

/**
 * Keep the network current for namespaces anyone — an agent, or the owner's
 * own wallet key — has been granted.
 *
 * A namespace nobody reads needs no publishing; one somebody reads should not
 * go stale because the watcher learned something after the grant.
 */
export async function publishShared(namespaces: string[]): Promise<string[]> {
  const out: string[] = []
  for (const ns of [...new Set(namespaces)]) {
    const m = await readManifest(appNetwork(), ns).catch(() => null)
    if (!m?.grants.length) continue
    await publishNamespace(ns)
    out.push(ns)
  }
  return out
}

/** Grant the owner's own recovery key first, so no namespace is shared with an agent but not with its owner. */
export async function ensureOwnerGrant(repo: Repository, owner: string): Promise<void> {
  await ensureHome(repo)
  const key = readOwnerKey(owner)
  if (!key) return
  const m = await readManifest(appNetwork(), repo.namespace).catch(() => null)
  if (m?.grants.some((g) => g.owner && g.pubkey.toLowerCase() === key.pubkey)) return
  await grantAccess(repo, appNetwork(), { agent: 'You (wallet key)', pubkey: key.pubkey, owner: true })
}

export type ShareRequest = { agent: string; pubkey: Hex; role?: AccessRole }

export async function shareNamespace(owner: string, namespace: string, req: ShareRequest): Promise<AccessManifest> {
  if (!namespacesOf(owner).includes(namespace)) throw new Error(`${namespace} is not one of ${owner}'s namespaces`)
  if (!/^0x(04[0-9a-fA-F]{128}|0[23][0-9a-fA-F]{64})$/.test(req.pubkey)) throw new Error('agent key must be a secp256k1 public key')
  const repo = Repository.open(namespace)
  await ensureOwnerGrant(repo, owner)
  await ensureHome(repo)
  return grantAccess(repo, appNetwork(), { agent: req.agent.slice(0, 60), pubkey: req.pubkey, role: req.role ?? 'read' })
}

export async function unshareNamespace(owner: string, namespace: string, grantId: string): Promise<AccessManifest> {
  if (!namespacesOf(owner).includes(namespace)) throw new Error(`${namespace} is not one of ${owner}'s namespaces`)
  const m = await readManifest(appNetwork(), namespace)
  if (m?.grants.find((g) => g.id === grantId)?.owner) throw new Error('the owner key cannot be revoked — it is how you read your own memory')
  const repo = Repository.open(namespace)
  await ensureHome(repo)
  return revokeAccess(repo, appNetwork(), grantId)
}

/** Agents with access to anything this owner has, grouped by key. */
export type AgentView = { id: string; agent: string; pubkey: Hex; namespaces: { namespace: string; role: AccessRole; grantedAt: string }[] }

export async function agentsOf(owner: string): Promise<AgentView[]> {
  const by = new Map<string, AgentView>()
  for (const ns of namespacesOf(owner)) {
    const m = await readManifest(appNetwork(), ns).catch(() => null)
    for (const g of m?.grants ?? []) {
      if (g.owner) continue
      const a = by.get(g.id) ?? { id: g.id, agent: g.agent, pubkey: g.pubkey, namespaces: [] }
      a.namespaces.push({ namespace: ns, role: g.role, grantedAt: g.grantedAt })
      by.set(g.id, a)
    }
  }
  return [...by.values()]
}

/**
 * Read a namespace the way an outside agent would — from the network only,
 * with a key. Used to show the owner that what they granted is readable and
 * what they did not is not; it is never how this app reads its own data.
 */
export async function readAsAgent(namespace: string, privateKey: Hex): Promise<ResolvedNamespace | { denied: string } | { unpublished: true }> {
  try { return await resolveNamespace(appNetwork(), namespace, { privateKey }) }
  catch (e) {
    if (e instanceof AccessDenied) return { denied: e.message }
    if (e instanceof NotPublished) return { unpublished: true }
    throw e
  }
}

/**
 * Seal every namespace this owner has to their wallet-derived key, and publish.
 *
 * After this, the owner can read all of it from the network with nothing but
 * their wallet — which is the whole of the portability claim, made checkable.
 */
export async function protectWithOwnerKey(owner: string): Promise<string[]> {
  const done: string[] = []
  for (const ns of namespacesOf(owner)) {
    await ensureOwnerGrant(Repository.open(ns), owner)
    done.push(ns)
  }
  return done
}

// ---------------------------------------------------------------------------
// A gateway onto the network — what IPFS and ENS gateways would serve
// ---------------------------------------------------------------------------

/**
 * A namespace's public records. Everything here is public on a real network:
 * a contenthash, and a manifest of public keys and sealed keys.
 */
export async function networkRecords(namespace: string): Promise<{ namespace: string; contenthash: Hex | null; refsCid: string | null; access: string | null }> {
  const net = appNetwork()
  const records = net.records(namespace)
  const [contenthash, access] = await Promise.all([records.read(), records.readText('knowledge.access')])
  return { namespace, contenthash, refsCid: contenthash ? net.storage.fromContenthash(contenthash).ref : null, access }
}

/** Raw bytes for a CID, exactly as stored — ciphertext for anything private. */
export async function networkObject(cid: string): Promise<Uint8Array | null> {
  if (!/^[a-z0-9]{20,100}$/i.test(cid)) return null
  try { return await appNetwork().storage.get({ kind: appNetwork().storage.kind, ref: cid }, { plaintext: true }) } catch { return null }
}
