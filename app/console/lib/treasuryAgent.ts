/**
 * Agent B — Portfolio Intelligence — and what it reads before it answers.
 *
 *   treasury.eth       Inherited by default. Agent A's memory: prices and their
 *                      24h moves, yields on Base, what large Base wallets hold,
 *                      benchmarks, and the owner's playbook.
 *   <your name>.eth    Optional, brought with you: your own memory — which
 *                      wallets are yours, which you track, which coins you
 *                      watch, what you spend and how much risk you take.
 *   the wallets        Yours and the ones your memory tracks, read live on Base:
 *                      balances through MultiBaas, history through Blockscout.
 *
 * Nothing is copied into the agent. It reads, answers, and cites where each
 * statement came from.
 */
import { findOwner } from '@knowledge01/core'
import type { Knowledge } from '@knowledge01/core'
import { serverClient } from './chain'
import { defaultBranch, knownNamespaces, loadRepo, snapshotOf, versionOf } from './repoview'
import { BASE_TOKENS, prices, readBaseWallet, type Holding } from './basePortfolio'
import { DEMO_WALLET } from './baseWatch'
import { readBaseMovements, type Movement } from './onchain'

export const TREASURY = 'treasury.eth'
/** Agent A's paid tier: sealed, sold over x402, bought by Agent B when a question needs it. */
export const SIGNALS = 'signals.treasury.eth'

/** Children a person's name commonly carries; checked in addition to anything known locally. */
const COMMON_CHILDREN = ['portfolio', 'finance', 'wallets', 'watchlist', 'notes', 'projects', 'work']
const MAX_WALLETS = 6

export type Claim = { id: string; subject: string | null; claim: string; topic: string | null; sources: string[]; contributor: string; confidence: number }
export type Memory = { namespace: string; version: number; claims: Claim[] }
export type PortfolioWallet = {
  role: 'yours' | 'tracked'
  label: string
  address: string
  /** Why Agent B is reading it: the dashboard, a claim in your memory, the demo. */
  via: string
  totalUsd: number
  holdings: Holding[]
  movements: Movement[]
}
export type Context = {
  treasury: Memory | null
  user: { name: string | null; owner: string | null; memories: Memory[]; unreadable: { namespace: string; reason: string }[]; watchCoins: string[] }
  wallets: PortfolioWallet[]
  walletErrors: { input: string; error: string }[]
  prices: Record<string, number>
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
export const loadMemory = (namespace: string): Promise<Memory | null> => memoryOf(namespace).catch(() => null)

export function normaliseName(raw: string): string {
  const n = raw.trim().toLowerCase()
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.eth$/.test(n)) throw new Error('enter an ENS name, e.g. yourname.eth')
  return n
}

const ADDRESS = /0x[0-9a-fA-F]{40}/g
const MINE = /\b(my|our)\s+(main\s+|own\s+|primary\s+)?(wallet|address|treasury|account)\b/i
const SYMBOLS = ['ETH', 'BTC', ...BASE_TOKENS.map((t) => t.symbol)]

/**
 * What the person's memory asks Agent B to read: wallets that are theirs,
 * wallets they track, and coins they watch. Read from the claims themselves,
 * so editing the memory changes what the agent follows.
 */
export function trackedFrom(memories: Memory[]): { wallets: { role: PortfolioWallet['role']; label: string; address: string; via: string }[]; coins: string[] } {
  const wallets = new Map<string, { role: PortfolioWallet['role']; label: string; address: string; via: string }>()
  const coins = new Set<string>()
  for (const m of memories) for (const c of m.claims) {
    for (const a of c.claim.match(ADDRESS) ?? []) {
      const k = a.toLowerCase()
      if (!wallets.has(k)) wallets.set(k, { role: MINE.test(c.claim) || c.topic === 'wallets' ? 'yours' : 'tracked', label: c.subject ?? `${a.slice(0, 6)}…${a.slice(-4)}`, address: a, via: `${m.namespace}: ${c.subject ?? c.id}` })
    }
    if (c.topic === 'watchlist' || /\b(watch|track|follow)/i.test(c.claim)) for (const s of SYMBOLS) if (new RegExp(`\\b${s}\\b`).test(c.claim)) coins.add(s)
  }
  return { wallets: [...wallets.values()], coins: [...coins] }
}

// A conversation asks for the same context several times.
const cache = new Map<string, { at: number; ctx: Context }>()

export async function loadContext(rawName: string | null, extra: string[] = []): Promise<Context> {
  const name = rawName?.trim() ? normaliseName(rawName) : null
  const added = [...new Set(extra.map((a) => a.trim()).filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a)))].slice(0, 3)
  const key = [name ?? '', ...added.map((e) => e.toLowerCase()).sort()].join('|')
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < 60_000) return hit.ctx

  const candidates = name ? [...new Set([name, ...COMMON_CHILDREN.map((c) => `${c}.${name}`), ...knownNamespaces().filter((n) => n.endsWith(`.${name}`))])] : []
  const [treasury, owner, p, ...loaded] = await Promise.all([
    loadTreasury(),
    name ? findOwner(serverClient(), name).then((o) => (BigInt(o) === 0n ? null : o)).catch(() => null) : Promise.resolve(null),
    prices().catch(() => ({} as Record<string, number>)),
    ...candidates.map((ns) => memoryOf(ns).then((m) => ({ ns, m, err: null as string | null })).catch((e: unknown) => ({ ns, m: null, err: e instanceof Error ? e.message : 'unreadable' }))),
  ])
  const memories = loaded.filter((l) => l.m && l.m.claims.length).map((l) => l.m!)
  const unreadable = loaded.filter((l) => l.err).map((l) => ({ namespace: l.ns, reason: l.err! }))
  const tracked = trackedFrom(memories)

  // Yours first — added on the page, then named in your memory, then the
  // name's owner — and the demo wallet only when there is nothing else.
  const list = new Map<string, { role: PortfolioWallet['role']; label: string; address: string; via: string }>()
  const put = (w: { role: PortfolioWallet['role']; label: string; address: string; via: string }) => { if (!list.has(w.address.toLowerCase()) && list.size < MAX_WALLETS) list.set(w.address.toLowerCase(), w) }
  added.forEach((a) => put({ role: 'yours', label: 'Your wallet', address: a, via: 'added on this page' }))
  tracked.wallets.filter((w) => w.role === 'yours').forEach(put)
  if (owner) put({ role: 'yours', label: `${name} owner`, address: owner, via: `owns ${name}` })
  tracked.wallets.filter((w) => w.role === 'tracked').forEach(put)
  if (![...list.values()].some((w) => w.role === 'yours')) put({ role: 'yours', label: DEMO_WALLET.label, address: DEMO_WALLET.address, via: 'demo wallet' })

  const read = await Promise.all([...list.values()].map(async (w) => {
    try {
      const [b, movements] = await Promise.all([readBaseWallet(w.label, w.address), readBaseMovements(w.address, p.ethereum ?? 0).catch(() => [] as Movement[])])
      return { w: { ...w, totalUsd: b.totalUsd, holdings: b.holdings, movements } as PortfolioWallet, e: null }
    } catch (e) { return { w: null, e: { input: w.label, error: e instanceof Error ? e.message : 'could not read the wallet' } } }
  }))
  // The name's owner is a Sepolia key; on Base it is often empty, and an empty wallet is noise.
  const wallets = read.filter((r) => r.w && !(r.w.via.startsWith('owns ') && !r.w.totalUsd && !r.w.movements.length)).map((r) => r.w!)

  const ctx: Context = { treasury, user: { name, owner, memories, unreadable, watchCoins: tracked.coins }, wallets, walletErrors: read.filter((r) => r.e).map((r) => r.e!), prices: p }
  cache.set(key, { at: Date.now(), ctx })
  return ctx
}

const DAY = 86_400_000

/** Money in and out over a window, in USD, from the movements Blockscout returned. */
function flows(ms: Movement[], days: number) {
  const since = Date.now() - days * DAY
  const w = ms.filter((m) => Date.parse(m.at) >= since && m.ok)
  const sum = (d: Movement['direction']) => Math.round(w.filter((m) => m.direction === d).reduce((n, m) => n + (m.usd ?? 0), 0))
  return { in_usd: sum('in'), out_usd: sum('out'), movements: w.length }
}

/** The context as the model sees it: compact, labelled by where each part came from. */
export function promptData(ctx: Context, paid: { namespace: string; version: number; claims: Pick<Claim, 'id' | 'subject' | 'claim' | 'topic'>[] } | null = null): string {
  const mem = (m: Memory) => ({
    namespace: m.namespace, version: m.version,
    claims: m.claims.map((c) => ({ id: c.id, topic: c.topic, subject: c.subject, claim: c.claim, sources: c.sources, by: c.contributor })),
  })
  const priced = Object.fromEntries([['ETH', ctx.prices.ethereum], ...BASE_TOKENS.map((t) => [t.symbol, ctx.prices[t.coingecko]])].filter(([, v]) => v).map(([k, v]) => [k, +(v as number).toPrecision(6)]))
  return JSON.stringify({
    treasury_memory: ctx.treasury ? mem(ctx.treasury) : null,
    paid_memory: paid ? { namespace: paid.namespace, version: paid.version, claims: paid.claims.map((c) => ({ id: c.id, topic: c.topic, subject: c.subject, claim: c.claim })) } : null,
    user_memory: ctx.user.name ? { name: ctx.user.name, namespaces: ctx.user.memories.map(mem), watched_coins: ctx.user.watchCoins } : null,
    prices_now_usd: priced,
    wallets: ctx.wallets.map((w) => ({
      role: w.role, label: w.label, address: w.address, read_because: w.via, chain: 'Base mainnet',
      total_usd: Math.round(w.totalUsd),
      holdings: w.holdings.map((h) => ({ asset: h.symbol, amount: +h.units.toPrecision(6), usd: Math.round(h.usd), share_pct: w.totalUsd ? +((h.usd / w.totalUsd) * 100).toFixed(1) : 0, stable: h.stable, yield_bearing: !!h.yieldBearing })),
      flows_7d: flows(w.movements, 7), flows_30d: flows(w.movements, 30),
      movements_seen: w.movements.length, oldest_movement_seen: w.movements.at(-1)?.at.slice(0, 10) ?? null,
      recent_movements: w.movements.slice(0, w.role === 'yours' ? 40 : 15).map((m) => ({ at: m.at.slice(0, 10), dir: m.direction, asset: m.asset, amount: +m.units.toPrecision(6), usd: m.usd === null ? null : Math.round(m.usd), counterparty: m.counterpartyName ?? `${m.counterparty.slice(0, 6)}…${m.counterparty.slice(-4)}`, method: m.method, ok: m.ok, tx: m.hash.slice(0, 10) })),
    })),
    wallets_unavailable: ctx.walletErrors,
  })
}
