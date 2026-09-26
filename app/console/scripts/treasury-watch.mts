/**
 * Agent A — the treasury watcher.
 *
 * Pre-connected, through MultiBaas, to a handful of large wallets on Base and
 * to public price and yield feeds. Each run it reads them and writes what it saw
 * into treasury.eth as sourced claims: prices and their 24h moves, yields on
 * Base, what each wallet holds, and how they compare. It writes as
 * treasury-watcher.eth through a proposal; the namespace's policy (approvals
 * 0, conflicts latest) lands it with findings recorded, and a newer reading
 * replaces an older one while history keeps both.
 *
 * It never writes a policy — those are the owner's, seeded once. Agent B
 * inherits all of it and answers from it.
 *
 * It also writes a paid tier, signals.treasury.eth: each watched wallet's
 * flows over the last 7 days. That namespace is encrypted and sold over x402
 * (see app/api/x402/grant); an agent that pays gets its key sealed to it.
 *
 *   pnpm --filter @knowledge01/console treasury:watch [--push]
 */
import { existsSync } from 'node:fs'
import { config as loadEnv } from 'dotenv'
import { createPublicClient, createWalletClient, http, type PublicClient, type WalletClient } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import { normalisePrivateKey, type Source } from '@knowledge01/core'
import { EnsPointer, Remote, Repository } from '@knowledge01/repo'
import { createStorage } from '@knowledge01/storage'
import { BASE_TOKENS, prices as basePrices, readBaseWallet, type BaseWallet } from '../lib/basePortfolio.ts'
import { readBaseMovements } from '../lib/onchain.ts'
import { WATCHED } from '../lib/baseWatch.ts'

for (const p of ['.env', '../../.env']) if (existsSync(p)) loadEnv({ path: p })

const NAMESPACE = 'treasury.eth'
const WATCHER = 'treasury-watcher.eth'
/** The paid tier, sold over x402. */
const SIGNALS = 'signals.treasury.eth'


const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
const compact = (n: number) => n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}k` : usd(n)
const pct = (n: number) => (n > 0 && n < 0.1 ? "<0.1%" : n < 1 && n > 0 ? `${n.toFixed(1)}%` : `${n.toFixed(0)}%`)
const day = (d = new Date()) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2 }

type Item = { subject: string; claim: string; topic: string; type?: string; confidence: number; sources: Source[]; supersedes?: string }

/** Prices and 24h moves for every coin the dashboard reads, from DefiLlama (keyless). */
async function prices(): Promise<Item[]> {
  const coins = [['ETH', 'coingecko:ethereum'], ['BTC', 'coingecko:bitcoin'], ...BASE_TOKENS.filter((t) => !t.stable && !['WETH'].includes(t.symbol)).map((t) => [t.symbol, `base:${t.address}`])] as const
  const ids = coins.map(([, id]) => id).join(',')
  const [now, change] = await Promise.all([
    fetch(`https://coins.llama.fi/prices/current/${ids}`, { signal: AbortSignal.timeout(20_000) }).then((r) => r.json() as Promise<{ coins: Record<string, { price: number }> }>),
    fetch(`https://coins.llama.fi/percentage/${ids}?period=24h`, { signal: AbortSignal.timeout(20_000) }).then((r) => r.json() as Promise<{ coins: Record<string, number> }>).catch(() => ({ coins: {} as Record<string, number> })),
  ])
  const find = <T>(m: Record<string, T>, id: string) => Object.entries(m).find(([k]) => k.toLowerCase() === id.toLowerCase())?.[1]
  const src: Source = { type: 'api', title: 'DefiLlama coin prices', id: `https://coins.llama.fi/prices/current/${ids}` } as Source
  return coins.flatMap(([sym, id]) => {
    const q = find(now.coins, id), c = find(change.coins, id)
    if (!q) return []
    const price = q.price >= 1 ? usd(q.price) : `$${q.price.toPrecision(3)}`
    return [{ subject: `${sym} price`, topic: 'prices', type: 'observation', confidence: 0.95, sources: [src],
      claim: `${sym} traded at ${price}${c === undefined ? '' : ` (${c >= 0 ? '+' : ''}${c.toFixed(1)}% over 24h)`} on ${day()}` }]
  })
}

/**
 * Yields on Base for what these wallets hold, from DefiLlama's yields index:
 * the largest pool per asset among blue-chip lending markets, and the staking
 * rate that cbETH and wstETH earn by themselves.
 */
const LENDING = ['aave-v3', 'compound-v3', 'moonwell-lending', 'fluid-lending']
const NAMES: Record<string, string> = { 'aave-v3': 'Aave v3', 'compound-v3': 'Compound v3', 'moonwell-lending': 'Moonwell', 'fluid-lending': 'Fluid', lido: 'Lido', 'coinbase-wrapped-staked-eth': 'Coinbase staking' }
async function yields(): Promise<Item[]> {
  const url = 'https://yields.llama.fi/pools'
  const pools = ((await (await fetch(url, { signal: AbortSignal.timeout(60_000) })).json()) as { data: { chain: string; project: string; symbol: string; apy: number | null; tvlUsd: number; exposure: string; pool: string }[] }).data
  const src = (pool: string): Source => ({ type: 'api', title: 'DefiLlama yields', id: `https://defillama.com/yields/pool/${pool}` } as Source)
  const out: Item[] = []
  for (const sym of ['USDC', 'EURC', 'WETH', 'cbBTC']) {
    const best = pools.filter((p) => p.chain === 'Base' && LENDING.includes(p.project) && p.symbol.toUpperCase() === sym.toUpperCase() && p.exposure === 'single' && (p.apy ?? 0) > 0 && p.tvlUsd > 2e6)
      .sort((a, b) => b.tvlUsd - a.tvlUsd).slice(0, 2)
    if (!best.length) continue
    out.push({ subject: `${sym} yield on Base`, topic: 'yields', type: 'observation', confidence: 0.85, sources: best.map((p) => src(p.pool)),
      claim: `Lending ${sym} on Base pays ${best.map((p) => `${(p.apy ?? 0).toFixed(2)}% APY on ${NAMES[p.project]} (${compact(p.tvlUsd)} supplied)`).join(' and ')} on ${day()}` })
  }
  for (const [sym, project, symbol] of [['cbETH', 'coinbase-wrapped-staked-eth', 'CBETH'], ['wstETH', 'lido', 'STETH']] as const) {
    const p = pools.filter((x) => x.project === project && x.chain === 'Ethereum' && x.symbol === symbol).sort((a, b) => b.tvlUsd - a.tvlUsd)[0]
    if (p?.apy) out.push({ subject: `${sym} staking yield`, topic: 'yields', type: 'observation', confidence: 0.85, sources: [src(p.pool)],
      claim: `${sym} earns about ${p.apy.toFixed(2)}% a year in ETH staking rewards through ${NAMES[project]}, held as is on Base, as of ${day()}` })
  }
  return out
}

function treasuryItems(w: BaseWallet, label: string): { items: Item[]; stablePct: number } {
  const src: Source = { type: 'api', title: `MultiBaas on Base: balanceOf and ETH balance for ${label}`, id: w.address } as Source
  const stable = w.holdings.filter((h) => h.stable).reduce((n, h) => n + h.usd, 0)
  const stablePct = w.totalUsd ? (stable / w.totalUsd) * 100 : 0
  // ETH, WETH and cbETH are one exposure when naming the largest asset.
  const family = (s: string) => (['WETH', 'cbETH'].includes(s) ? 'ETH' : s)
  const volatile = new Map<string, number>()
  for (const h of w.holdings.filter((x) => !x.stable)) volatile.set(family(h.symbol), (volatile.get(family(h.symbol)) ?? 0) + h.usd)
  const top = [...volatile.entries()].sort((a, b) => b[1] - a[1])[0]
  const who = label.startsWith('Unlabelled') ? `An unlabelled Base whale (${w.address.slice(0, 6)}…${w.address.slice(-4)})` : label
  return {
    stablePct,
    items: [{
      subject: label.startsWith('Unlabelled') ? `Base whale ${w.address.slice(0, 6)}` : label, topic: 'treasuries', type: 'observation', confidence: 0.9, sources: [src],
      claim: `${who} holds about ${compact(w.totalUsd)} on Base on ${day()}, ${stablePct < 1 && stablePct > 0 ? stablePct.toFixed(1) : pct(stablePct).replace('%', '')}% of it in stablecoins${top && w.totalUsd ? `; its largest exposure is ${top[0]} at ${pct((top[1] / w.totalUsd) * 100)}` : ''}`,
    }],
  }
}

async function main() {
  const push = process.argv.includes('--push')
  const repo = Repository.open(NAMESPACE)
  repo.actingAs = WATCHER

  const items: Item[] = []
  items.push(...(await prices()))
  items.push(...(await yields().catch((e) => { console.warn(`skip yields: ${e instanceof Error ? e.message : e}`); return [] as Item[] })))
  const shares: { label: string; stablePct: number }[] = []
  for (const t of WATCHED) {
    try {
      const w = await readBaseWallet(t.label, t.address)
      const r = treasuryItems(w, t.label)
      items.push(...r.items)
      shares.push({ label: t.label, stablePct: r.stablePct })
      console.log(`read ${t.label.padEnd(18)} ${t.address.slice(0, 8)} ${compact(w.totalUsd).padStart(8)} · ${pct(r.stablePct)} stable`)
    } catch (e) {
      console.warn(`skip ${t.label}: ${e instanceof Error ? e.message : e}`)
    }
  }
  if (shares.length >= 2) {
    const xs = shares.map((s) => s.stablePct)
    items.push({
      subject: 'Stablecoin share across watched treasuries', topic: 'benchmarks', type: 'observation', confidence: 0.8,
      sources: [{ type: 'agent', title: `${WATCHER}, computed from the ${shares.length} Base wallet readings of ${day()}` } as Source],
      claim: `Across ${shares.length} watched wallets on Base on ${day()}, stablecoins are a median ${pct(median(xs))} of holdings (lowest ${pct(Math.min(...xs))}, highest ${pct(Math.max(...xs))})`,
    })
  }

  await land(repo, items, ['treasuries', 'flows'], `Treasury watch, ${day()}`)
  await publish(repo, NAMESPACE, push)

  // The paid tier: who moved what, fresher and finer than the free readings.
  const signals = Repository.open(SIGNALS)
  signals.actingAs = WATCHER
  await land(signals, await flowSignals(), ['flows', 'signals'], `Whale flows, ${day()}`)
  await publish(signals, SIGNALS, push)
}

/**
 * Money in and out of each watched wallet over the last 7 days, from its
 * transfers on Base, and the single largest move. This is the work a buyer's
 * agent would otherwise repeat: every transfer of every watched wallet, priced.
 */
async function flowSignals(): Promise<Item[]> {
  const eth = (await basePrices()).ethereum ?? 0
  const since = Date.now() - 7 * 86_400_000
  const out: Item[] = []
  const nets: { who: string; net: number; moved: number }[] = []
  for (const t of WATCHED) {
    const ms = (await readBaseMovements(t.address, eth).catch(() => [])).filter((m) => m.ok && Date.parse(m.at) >= since)
    const sum = (d: string) => ms.filter((m) => m.direction === d).reduce((n, m) => n + (m.usd ?? 0), 0)
    const [inn, outt] = [sum('in'), sum('out')]
    const top = [...ms].sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0))[0]
    const who = t.label.startsWith('Unlabelled') ? `Base whale ${t.address.slice(0, 6)}` : t.label
    const src: Source = { type: 'api', title: `Base Blockscout transfers for ${who}`, id: `https://base.blockscout.com/address/${t.address}` } as Source
    const amount = (m: typeof top) => m ? `${Number(m.units.toPrecision(4)).toLocaleString('en-US')} ${m.asset} (${compact(m.usd ?? 0)})` : ''
    out.push({
      subject: `${who} flows`, topic: 'flows', type: 'observation', confidence: 0.85, sources: [src],
      claim: ms.length
        ? `${who} moved ${compact(outt)} out and ${compact(inn)} in over the 7 days to ${day()}, across ${ms.length} transfer${ms.length === 1 ? '' : 's'}; the largest was ${amount(top)} ${top!.direction === 'out' ? 'out to' : 'in from'} ${top!.counterpartyName ?? `${top!.counterparty.slice(0, 6)}…${top!.counterparty.slice(-4)}`} on ${day(new Date(top!.at))}`
        : `${who} made no transfers on Base in the 7 days to ${day()}`,
    })
    nets.push({ who, net: inn - outt, moved: inn + outt })
    console.log(`flows ${who.padEnd(22)} out ${compact(outt).padStart(8)} · in ${compact(inn).padStart(8)} · ${ms.length} transfers`)
  }
  const busiest = [...nets].sort((a, b) => b.moved - a.moved)[0]
  const net = nets.reduce((n, x) => n + x.net, 0)
  if (busiest?.moved) out.push({
    subject: 'Net whale flow', topic: 'signals', type: 'observation', confidence: 0.8,
    sources: [{ type: 'agent', title: `${WATCHER}, computed from the 7-day flows of ${nets.length} Base wallets` } as Source],
    claim: `Across ${nets.length} watched Base wallets, the net flow over the 7 days to ${day()} was ${net >= 0 ? '+' : '−'}${compact(Math.abs(net))}; the busiest was ${busiest.who}, moving ${compact(busiest.moved)}`,
  })
  return out
}

/**
 * Write a reading through a proposal the namespace's policy lands. A new
 * reading of the same thing supersedes the last, an identical one is skipped,
 * and readings of wallets no longer watched are retired — history keeps them.
 */
async function land(repo: Repository, items: Item[], retireTopics: string[], title: string) {
  const current = Object.values(repo.headSnapshot(repo.refs.head))
  const fresh: Item[] = []
  for (const i of items) {
    const prev = current.find((k) => k.subject === i.subject && k.topic === i.topic)
    if (prev?.claim === i.claim) continue
    fresh.push(prev ? { ...i, supersedes: prev.id } : i)
  }
  const produced = new Set(items.map((i) => `${i.topic}|${i.subject}`))
  const retire = current.filter((k) => retireTopics.includes(k.topic ?? '') && !produced.has(`${k.topic}|${k.subject}`))
  if (!fresh.length && !retire.length) { console.log(`${repo.namespace}: nothing changed since the last reading`); return }

  const add = (i: Item) => repo.add({ claim: i.claim, subject: i.subject, topic: i.topic, ...(i.type ? { type: i.type } : {}), confidence: i.confidence, sources: i.sources, ...(i.supersedes ? { supersedes: i.supersedes } : {}) })
  // A namespace's first reading has nothing to propose against, and only the
  // owner may start main; the claims still name the watcher as their source.
  if (!repo.refs.branches[repo.branch]) {
    const as = repo.actingAs
    repo.actingAs = repo.policy.owner
    fresh.forEach(add)
    repo.commit(title)
    repo.actingAs = as
    console.log(`${repo.namespace}: first reading, v1 · ${fresh.length} claims`)
    return
  }
  const base = repo.branch
  const branch = `watch/${Date.now().toString(36)}`
  repo.checkout(branch, { create: true })
  try {
    for (const k of retire) repo.remove(k.id)
    fresh.forEach(add)
    repo.commit(title)
    const p = repo.propose({ title, branch })
    console.log(`${repo.namespace}: proposal #${p.number} ${p.status}${p.findings.length ? ` · ${p.findings.length} finding(s)` : ''}`)
  } finally {
    repo.checkout(base)
  }
  console.log(`${repo.namespace} is at v${repo.version(repo.refs.head)} · ${Object.keys(repo.headSnapshot(repo.refs.head)).length} claims`)
}

async function publish(repo: Repository, name: string, push: boolean) {
  if (push) {
    const pk = normalisePrivateKey(process.env.PRIVATE_KEY)
    if (!pk) throw new Error('--push needs PRIVATE_KEY')
    const rpc = process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'
    const pc = createPublicClient({ chain: sepolia, transport: http(rpc) }) as PublicClient
    const wallet = createWalletClient({ account: privateKeyToAccount(pk), chain: sepolia, transport: http(rpc) }) as WalletClient
    const r = await new Remote(repo, createStorage(), new EnsPointer(name, pc, wallet)).push()
    console.log(`published ${name} v${repo.version(repo.refs.head)} — ${r.pushed.length} new commit(s)`)
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
