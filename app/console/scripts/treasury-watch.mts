/**
 * Agent A — the treasury watcher.
 *
 * Pre-connected to a handful of well-known treasuries on Ethereum mainnet and
 * to a public price feed. Each run it reads them and writes what it saw into
 * treasury.eth as sourced claims: prices, what each treasury holds, what moved
 * out of it, and how they compare. It writes as treasury-watcher.eth through a
 * proposal; the namespace's policy (approvals 0, conflicts latest) lands it
 * with findings recorded, and a newer reading replaces an older one while
 * history keeps both.
 *
 * It never writes a policy — those are the owner's, seeded once. Agent B reads
 * both and answers.
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
import { readWallet, type Wallet } from '../lib/onchain.ts'

for (const p of ['.env', '../../.env']) if (existsSync(p)) loadEnv({ path: p })

const NAMESPACE = 'treasury.eth'
const WATCHER = 'treasury-watcher.eth'

/** The treasuries Agent A is connected to, by the ENS names they publish. */
const WATCHED: { name: string; label: string }[] = [
  { name: 'wallet.ensdao.eth', label: 'ENS DAO treasury' },
  { name: 'uniswap.eth', label: 'Uniswap treasury' },
  { name: 'nouns.eth', label: 'Nouns DAO treasury' },
  { name: 'vitalik.eth', label: 'vitalik.eth' },
]

const PRICE_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=ethereum,bitcoin&vs_currencies=usd&include_24hr_change=true'

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
const compact = (n: number) => n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}k` : usd(n)
const pct = (n: number) => `${n.toFixed(0)}%`
const day = (d = new Date()) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2 }

type Item = { subject: string; claim: string; topic: string; type?: string; confidence: number; sources: Source[]; supersedes?: string }

async function prices(): Promise<Item[]> {
  const r = await fetch(PRICE_URL, { signal: AbortSignal.timeout(20_000) })
  if (!r.ok) throw new Error(`CoinGecko answered ${r.status}`)
  const p = (await r.json()) as Record<string, { usd: number; usd_24h_change?: number }>
  const src: Source = { type: 'api', title: 'CoinGecko simple price', id: PRICE_URL } as Source
  const line = (sym: string, q?: { usd: number; usd_24h_change?: number }) => q
    ? [{ subject: `${sym} price`, topic: 'prices', type: 'observation', confidence: 0.95, sources: [src],
        claim: `${sym} traded at ${usd(q.usd)} (${(q.usd_24h_change ?? 0) >= 0 ? '+' : ''}${(q.usd_24h_change ?? 0).toFixed(1)}% over 24h) on ${day()}` }]
    : []
  return [...line('ETH', p.ethereum), ...line('BTC', p.bitcoin)]
}

function treasuryItems(w: Wallet, label: string): { items: Item[]; stablePct: number } {
  const src: Source = { type: 'api', title: `Blockscout balances and transfers for ${w.ens ?? w.address}`, id: w.address } as Source
  const stable = w.holdings.filter((h) => h.stable).reduce((n, h) => n + h.usd, 0)
  const stablePct = w.totalUsd ? (stable / w.totalUsd) * 100 : 0
  // Wrapped ether is still ether: one exposure when naming the largest asset.
  const volatile = new Map<string, number>()
  for (const h of w.holdings.filter((x) => !x.stable)) { const k = h.symbol === 'WETH' ? 'ETH' : h.symbol; volatile.set(k, (volatile.get(k) ?? 0) + h.usd) }
  const topEntry = [...volatile.entries()].sort((a, b) => b[1] - a[1])[0]
  const top = topEntry ? { symbol: topEntry[0], usd: topEntry[1] } : undefined
  const eth = w.holdings.filter((h) => h.symbol === 'ETH' || h.symbol === 'WETH').reduce((n, h) => n + h.units, 0)
  const who = w.ens && w.ens !== label ? `${label} (${w.ens})` : label

  const since = Date.now() - 30 * 86_400_000
  const out = w.movements.filter((m) => m.direction === 'out' && m.ok && Date.parse(m.at) >= since && m.usd !== null)
  const outUsd = out.reduce((n, m) => n + (m.usd ?? 0), 0)
  const biggest = [...out].sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0))[0]

  const items: Item[] = [
    {
      subject: label, topic: 'treasuries', type: 'observation', confidence: 0.9, sources: [src],
      claim: `${who} holds about ${compact(w.totalUsd)} on ${day()}: ${eth.toLocaleString('en-US', { maximumFractionDigits: 0 })} ETH, and ${pct(stablePct)} in stablecoins${top && w.totalUsd ? `; its largest volatile asset is ${top.symbol} at ${pct((top.usd / w.totalUsd) * 100)}` : ''}`,
    },
    {
      subject: `${label} outflows`, topic: 'flows', type: 'observation', confidence: 0.85, sources: [src],
      claim: out.length
        ? `In the 30 days to ${day()}, ${label} sent ${compact(outUsd)} out in ${out.length} transfer${out.length === 1 ? '' : 's'}${biggest ? `; the largest was ${compact(biggest.usd ?? 0)} in ${biggest.asset} to ${biggest.counterpartyName ?? `${biggest.counterparty.slice(0, 8)}…`}` : ''}`
        : `${label} made no outgoing transfers in the 30 days to ${day()}`,
    },
  ]
  return { items, stablePct }
}

async function main() {
  const push = process.argv.includes('--push')
  const repo = Repository.open(NAMESPACE)
  repo.actingAs = WATCHER

  const items: Item[] = []
  items.push(...(await prices()))
  const shares: { label: string; stablePct: number }[] = []
  for (const t of WATCHED) {
    try {
      const w = await readWallet(t.name)
      const r = treasuryItems(w, t.label)
      items.push(...r.items)
      shares.push({ label: t.label, stablePct: r.stablePct })
      console.log(`read ${t.name.padEnd(20)} ${compact(w.totalUsd).padStart(8)} · ${pct(r.stablePct)} stable`)
    } catch (e) {
      console.warn(`skip ${t.name}: ${e instanceof Error ? e.message : e}`)
    }
  }
  if (shares.length >= 2) {
    const xs = shares.map((s) => s.stablePct)
    items.push({
      subject: 'Stablecoin share across watched treasuries', topic: 'benchmarks', type: 'observation', confidence: 0.8,
      sources: [{ type: 'agent', title: `${WATCHER}, computed from the ${shares.length} treasury readings of ${day()}` } as Source],
      claim: `Across ${shares.length} watched treasuries on ${day()}, stablecoins are a median ${pct(median(xs))} of holdings (lowest ${pct(Math.min(...xs))}, highest ${pct(Math.max(...xs))})`,
    })
  }

  // A new reading of the same thing replaces the last one: mark it `supersedes`
  // so it is a fact that changed, not a contradiction. An identical reading is
  // not written at all.
  const current = Object.values(repo.headSnapshot(repo.refs.head))
  const fresh: Item[] = []
  for (const i of items) {
    const prev = current.find((k) => k.subject === i.subject && k.topic === i.topic)
    if (prev?.claim === i.claim) continue
    fresh.push(prev ? { ...i, supersedes: prev.id } : i)
  }
  if (!fresh.length) { console.log('nothing changed since the last reading'); return publish(repo, push) }

  const base = repo.branch
  const branch = `watch/${Date.now().toString(36)}`
  repo.checkout(branch, { create: true })
  try {
    for (const i of fresh) repo.add({ claim: i.claim, subject: i.subject, topic: i.topic, ...(i.type ? { type: i.type } : {}), confidence: i.confidence, sources: i.sources, ...(i.supersedes ? { supersedes: i.supersedes } : {}) })
    repo.commit(`Treasury watch, ${day()}`)
    const p = repo.propose({ title: `Treasury watch, ${day()}`, branch })
    console.log(`proposal #${p.number}: ${p.status}${p.findings.length ? ` · ${p.findings.length} finding(s)` : ''}`)
  } finally {
    repo.checkout(base)
  }
  console.log(`${NAMESPACE} is at v${repo.version(repo.refs.head)} · ${Object.keys(repo.headSnapshot(repo.refs.head)).length} claims`)

  await publish(repo, push)
}

async function publish(repo: Repository, push: boolean) {
  if (push) {
    const pk = normalisePrivateKey(process.env.PRIVATE_KEY)
    if (!pk) throw new Error('--push needs PRIVATE_KEY')
    const rpc = process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'
    const pc = createPublicClient({ chain: sepolia, transport: http(rpc) }) as PublicClient
    const wallet = createWalletClient({ account: privateKeyToAccount(pk), chain: sepolia, transport: http(rpc) }) as WalletClient
    const r = await new Remote(repo, createStorage(), new EnsPointer(NAMESPACE, pc, wallet)).push()
    console.log(`published ${NAMESPACE} v${repo.version(repo.refs.head)} — ${r.pushed.length} new commit(s)`)
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
