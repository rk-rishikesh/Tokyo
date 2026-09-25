/**
 * Agent B — the treasury agent — and what it reads before it answers.
 *
 * Three things, each from where it actually lives:
 *
 *   treasury.eth       Agent A's memory: prices, what well-known treasuries
 *                      hold and moved, benchmarks, and the owner's playbook.
 *                      Resolved through ENS, fetched from IPFS.
 *   <your name>.eth    Your own memory, brought with you: the namespace at that
 *                      name and the ones under it that this deployment can read.
 *   your wallet        The address that owns that name on Sepolia, read live on
 *                      Ethereum mainnet — the same key controls both.
 *
 * Nothing is copied into the agent. It reads, answers, and cites where each
 * statement came from.
 */
import { findOwner } from '@knowledge01/core'
import type { Knowledge } from '@knowledge01/core'
import { serverClient } from './chain'
import { defaultBranch, knownNamespaces, loadRepo, snapshotOf, versionOf } from './repoview'
import { readWallet, type Wallet } from './onchain'

export const TREASURY = 'treasury.eth'

/** Children a person's name commonly carries; checked in addition to anything known locally. */
const COMMON_CHILDREN = ['portfolio', 'finance', 'notes', 'projects', 'work', 'food', 'travel', 'health']

export type Claim = { id: string; subject: string | null; claim: string; topic: string | null; sources: string[]; contributor: string; confidence: number }
export type Memory = { namespace: string; version: number; claims: Claim[] }
export type Context = {
  treasury: Memory | null
  user: { name: string; owner: string | null; memories: Memory[]; unreadable: { namespace: string; reason: string }[] }
  wallets: Wallet[]
  walletErrors: { input: string; error: string }[]
}

const toClaim = (k: Knowledge): Claim => ({
  id: k.id, subject: k.subject, claim: k.claim, topic: k.topic, contributor: k.contributor, confidence: k.confidence,
  sources: k.sources.map((s) => [s.type, s.title].filter(Boolean).join(': ')),
})

async function memoryOf(namespace: string): Promise<Memory | null> {
  const v = await loadRepo(namespace)
  if (!v) return null
  const b = defaultBranch(v)
  return { namespace, version: versionOf(v, b), claims: Object.values(snapshotOf(v, b)).map(toClaim) }
}

export const loadTreasury = (): Promise<Memory | null> => memoryOf(TREASURY).catch(() => null)

export function normaliseName(raw: string): string {
  const n = raw.trim().toLowerCase()
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.eth$/.test(n)) throw new Error('enter an ENS name, e.g. yourname.eth')
  return n
}

// Answers ask for the same context several times in a conversation.
const cache = new Map<string, { at: number; ctx: Context }>()

export async function loadContext(rawName: string, extra: string[] = []): Promise<Context> {
  const name = normaliseName(rawName)
  const key = [name, ...extra.map((e) => e.toLowerCase()).sort()].join('|')
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < 60_000) return hit.ctx

  const candidates = [...new Set([name, ...COMMON_CHILDREN.map((c) => `${c}.${name}`), ...knownNamespaces().filter((n) => n.endsWith(`.${name}`))])]
  const [treasury, owner, ...loaded] = await Promise.all([
    loadTreasury(),
    findOwner(serverClient(), name).then((o) => (BigInt(o) === 0n ? null : o)).catch(() => null),
    ...candidates.map((ns) => memoryOf(ns).then((m) => ({ ns, m, err: null as string | null })).catch((e: unknown) => ({ ns, m: null, err: e instanceof Error ? e.message : 'unreadable' }))),
  ])
  const memories = loaded.filter((l) => l.m && l.m.claims.length).map((l) => l.m!)
  const unreadable = loaded.filter((l) => l.err).map((l) => ({ namespace: l.ns, reason: l.err! }))

  // The wallet that owns the name, plus any the person added on this page.
  const inputs = [...new Set([...(owner ? [owner] : []), ...extra.slice(0, 4)].map((a) => a.trim()).filter(Boolean))]
  const read = await Promise.all(inputs.map((i) => readWallet(i).then((w) => ({ i, w, e: null as string | null })).catch((e: unknown) => ({ i, w: null, e: e instanceof Error ? e.message : 'could not read the wallet' }))))
  const wallets = read.filter((r) => r.w).map((r) => r.w!)
  const walletErrors = read.filter((r) => r.e).map((r) => ({ input: r.i, error: r.e! }))
  if (!owner) walletErrors.unshift({ input: name, error: 'not registered on Sepolia, so it has no owning wallet' })

  const ctx: Context = { treasury, user: { name, owner, memories, unreadable }, wallets, walletErrors }
  cache.set(key, { at: Date.now(), ctx })
  return ctx
}

/** The context as the model sees it: compact, labelled by where each part came from. */
export function promptData(ctx: Context): string {
  const mem = (m: Memory) => ({
    namespace: m.namespace, version: m.version,
    claims: m.claims.map((c) => ({ id: c.id, topic: c.topic, subject: c.subject, claim: c.claim, sources: c.sources, by: c.contributor })),
  })
  return JSON.stringify({
    treasury_memory: ctx.treasury ? mem(ctx.treasury) : null,
    user_memory: { name: ctx.user.name, namespaces: ctx.user.memories.map(mem) },
    user_wallets: ctx.wallets.map((w) => ({
      address: w.address, ens: w.ens, total_usd: Math.round(w.totalUsd),
      holdings: w.holdings.map((h) => ({ asset: h.symbol, amount: +h.units.toPrecision(6), usd: Math.round(h.usd), stable: h.stable })),
      recent_movements: w.movements.slice(0, 30).map((m) => ({ at: m.at.slice(0, 10), dir: m.direction, asset: m.asset, amount: +m.units.toPrecision(6), usd: m.usd === null ? null : Math.round(m.usd), counterparty: m.counterpartyName ?? m.counterparty, ok: m.ok })),
    })),
    wallets_unavailable: ctx.walletErrors,
  })
}
