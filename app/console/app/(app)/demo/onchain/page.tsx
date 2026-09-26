import Link from 'next/link'
import { HoldingsBars } from '@/components/demo/HoldingsBars'
import { Chips, Step, Steps } from '@/components/demo/Steps'
import { FlowGraph, type GraphEdge, type GraphNode } from '@/components/motion/FlowGraph'
import { readBaseWallet, type BaseWallet } from '@/lib/basePortfolio'
import { DEMO_WALLET, WATCHED } from '@/lib/baseWatch'
import { multibaasConfigured } from '@/lib/multibaas'
import { loadMemory, loadTreasury, SIGNALS, TREASURY, type Claim } from '@/lib/treasuryAgent'
import { manifestOf } from '@/lib/x402'
import type { AccessManifest } from '@knowledge01/repo'

export const metadata = { title: 'Demo — treasury dashboard' }
export const dynamic = 'force-dynamic'

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
/** $221.1M rather than $221,061,500: a table of whales is read by magnitude. */
const compactUsd = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `$${(n / 1e3).toFixed(1)}k` : usd(n))
/** Whole percents, except small shares: $43 of $9,004 is 0.5%, not 0%. */
const pct = (n: number) => (n > 0 && n < 0.1 ? '<0.1%' : n < 1 ? `${n.toFixed(1)}%` : `${n.toFixed(0)}%`)
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
/** One exposure per asset family: wrapped ether counts as ether. */
const largest = (w: BaseWallet) => {
  const m = new Map<string, number>()
  for (const h of w.holdings) { const k = h.symbol === 'WETH' ? 'ETH' : h.symbol; m.set(k, (m.get(k) ?? 0) + h.usd) }
  const top = [...m.entries()].sort((a, b) => b[1] - a[1])[0]
  return top && w.totalUsd ? { symbol: top[0], pct: (top[1] / w.totalUsd) * 100 } : null
}
const stablePct = (w: BaseWallet) => (w.totalUsd ? (w.holdings.filter((h) => h.stable).reduce((n, h) => n + h.usd, 0) / w.totalUsd) * 100 : 0)

export default async function TreasuryDashboard({ searchParams }: { searchParams: Promise<{ wallet?: string }> }) {
  const { wallet } = await searchParams
  const target = wallet && /^0x[0-9a-fA-F]{40}$/.test(wallet.trim()) ? { label: 'Your wallet', address: wallet.trim() } : DEMO_WALLET

  if (!multibaasConfigured()) {
    return <p className="rounded-2xl border border-dashed border-line p-8 text-dim">MultiBaas is not configured on this deployment (set MULTIBAAS_URL and MULTIBAAS_API_KEY).</p>
  }

  const [treasury, demoMemory, signals, me, ...peers] = await Promise.all([
    loadTreasury(),
    loadMemory(DEMO_MEMORY),
    manifestOf(SIGNALS).catch(() => null),
    readBaseWallet(target.label, target.address).catch(() => null),
    ...WATCHED.map((w) => readBaseWallet(w.label, w.address).catch(() => null)),
  ])
  const watched = peers.filter((p): p is BaseWallet => !!p)

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[12px] uppercase tracking-[0.12em] text-dim">Treasury dashboard · Base mainnet · via MultiBaas</p>
          <h1 className="mt-2 text-[clamp(1.9rem,3.6vw,3rem)] font-normal leading-[1.02] tracking-[-0.02em]">Know what you hold. Know what to do.</h1>
        </div>
        <Link href={`/demo/onchain/chat${wallet ? `?wallet=${wallet}` : ''}`} className="rounded-xl bg-ink px-4 py-2 text-[13.5px] text-bg hover:opacity-85">Ask Agent B →</Link>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
      {!me ? (
        <p className="rounded-2xl border border-dashed border-line p-8 text-dim">Could not read {short(target.address)} through MultiBaas right now.</p>
      ) : (
        <Card title={`Holdings · ${target.label} · ${usd(me.totalUsd)}`} note={`${short(me.address)} · MultiBaas · DefiLlama`}>
          <HoldingsBars bars={me.holdings} />
        </Card>
      )}

      <Card title="Watched treasuries" note="Agent A · Market Scout · via MultiBaas">
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full text-[14px] tabular-nums">
            <thead>
              <tr className="text-[11.5px] uppercase tracking-[0.08em] text-dim">
                <th className="px-1 pb-2 text-left font-normal">Wallet</th>
                <th className="px-1 pb-2 text-right font-normal">Value</th>
                <th className="px-1 pb-2 text-right font-normal">Stable</th>
                <th className="w-[42%] px-1 pb-2 pl-6 text-left font-normal">Largest asset</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line border-t border-line">
              {[...watched].sort((x, y) => y.totalUsd - x.totalUsd).map((w) => {
                const top = largest(w)
                return (
                  <tr key={w.address} className="transition-colors hover:bg-raised/50">
                    <td className="px-1 py-3">
                      <a href={`https://basescan.org/address/${w.address}`} target="_blank" rel="noreferrer" className="group block">
                        <span className="block font-medium text-ink group-hover:underline">{w.label.startsWith('Unlabelled') ? 'Base whale' : w.label}</span>
                        <span className="block font-mono text-[11.5px] text-dim">{short(w.address)}</span>
                      </a>
                    </td>
                    <td className="px-1 py-3 text-right font-medium">{compactUsd(w.totalUsd)}</td>
                    <td className="px-1 py-3 text-right text-dim">{pct(stablePct(w))}</td>
                    <td className="px-1 py-3 pl-6">
                      {top ? (
                        <span className="flex items-center gap-2.5">
                          <span className="w-12 font-medium">{top.symbol}</span>
                          <span className="h-1.5 min-w-12 flex-1 overflow-hidden rounded-full bg-raised" aria-hidden><span className="block h-full rounded-full bg-ink" style={{ width: `${Math.min(100, top.pct)}%` }} /></span>
                          <span className="w-10 text-right text-dim">{pct(top.pct)}</span>
                        </span>
                      ) : <span className="text-dim">—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
      </div>

      <section className="mt-10">
        <h2 className="font-display text-[1.9rem] font-normal leading-tight tracking-[-0.01em]">How it works</h2>
        <p className="mb-4 mt-1 max-w-3xl text-[15px] leading-relaxed text-dim">Agent A fills a shared memory; you connect your wallet; Agent B reads both and answers.</p>
        <HowItWorks treasury={treasury?.claims ?? []} version={treasury?.version} memory={demoMemory?.claims ?? []} memoryVersion={demoMemory?.version} watched={watched.length} signals={signals} />
        <FlowGraph cardH={150} cardW={400} nodes={NODES(treasury?.version, treasury?.claims.length, signals?.offers?.[0]?.price)} edges={EDGES} label="MultiBaas reads Base mainnet for Agent A (Market Scout), which writes prices, yields and whale readings to treasury.eth, and sealed 7-day whale flows to signals.treasury.eth. Agent B (Portfolio Intelligence) inherits treasury.eth, buys signals.treasury.eth over x402, adds your memory and your wallets, and answers with a report." />
      </section>
    </>
  )
}

const DEMO_MEMORY = 'personal.eth'

function HowItWorks({ treasury, version, memory, memoryVersion, watched, signals }: { treasury: Claim[]; version?: number; memory: Claim[]; memoryVersion?: number; watched: number; signals: AccessManifest | null }) {
  const offer = signals?.offers?.find((o) => o.role === 'read')
  const count = (topic: string) => treasury.filter((c) => c.topic === topic).length
  return (
    <Steps row className="mb-8">
      <Step n={1} title="Agent A fills the memory">
        <p>Token prices, yields on Base and whale readings, plus the playbook, stored in <Link href={`/k/${TREASURY}`} className="font-mono text-ink underline">{TREASURY}</Link>. Fresh whale flows sit in a paid tier.</p>
        <Chips items={[`${count('prices')} prices`, `${count('yields')} yields`, `${watched} whales`, `${count('policy')}-rule playbook`, version ? `${TREASURY} v${version}` : null, offer ? `paid tier · ${offer.price}/week` : null]} />
      </Step>
      <Step n={2} title="You connect">
        <p>Your Base wallet, and your own memory if you have one: wallets you track, coins you watch, how you invest.</p>
        <Chips items={['Base wallet via MultiBaas', memory.length ? `example: ${DEMO_MEMORY} v${memoryVersion} · ${memory.length} claims` : 'ENS memory, optional']} />
      </Step>
      <Step n={3} title="Agent B reads both and answers">
        <p>Holdings, transactions, yield and history, with every figure cited. It buys the paid tier only when a question needs it.</p>
        <Link href={`/demo/onchain/chat?name=${DEMO_MEMORY}`} className="flex w-fit rounded-xl bg-ink px-4 py-2 text-[13.5px] text-bg hover:opacity-85">Try it with {DEMO_MEMORY} →</Link>
      </Step>
    </Steps>
  )
}


const NODES = (version?: number, claims?: number, price?: string): GraphNode[] => [
  { id: 'base', n: 1, title: 'Base mainnet', sub: 'Your wallets, and the large wallets Agent A watches.', x: 215, y: 190, icon: 'eye' },
  { id: 'mb', n: 2, title: 'MultiBaas', sub: 'Reads every balance on Base. No RPC node to run.', x: 215, y: 570, icon: 'calc' },
  { id: 'a', n: 3, title: 'Agent A', tag: 'Market Scout', sub: 'Watches whales, prices and yields; writes both tiers.', x: 660, y: 380, icon: 'agent' },
  { id: 't', n: 4, title: TREASURY, sub: version ? `Free · v${version} · ${claims} claims: prices, yields, whales.` : 'Free: prices, yields, whales, the playbook.', x: 1100, y: 95, icon: 'flag', href: `/k/${TREASURY}` },
  { id: 'sig', n: 5, title: SIGNALS, sub: `Agent B pays ${price ?? '$0.01'} over x402 per week.`, x: 1100, y: 285, icon: 'lock', href: `/k/${SIGNALS}` },
  { id: 'mem', n: 6, title: 'Your memory', sub: 'yourname.eth: wallets you track, coins you watch.', x: 1100, y: 475, icon: 'name' },
  { id: 'you', n: 7, title: 'Your wallets', sub: 'Balances via MultiBaas, history via Blockscout.', x: 1100, y: 665, icon: 'key' },
  { id: 'b', n: 8, title: 'Agent B', tag: 'Portfolio Intelligence', sub: 'Inherits treasury.eth, buys signals, adds your memory, reports.', x: 1540, y: 380, icon: 'agent', final: true },
]
const EDGES: GraphEdge[] = [
  { from: 'base', to: 'mb', at: 10 },
  { from: 'mb', to: 'a', at: 30 },
  { from: 'a', to: 't', at: 55 },
  { from: 'a', to: 'sig', at: 70 },
  { from: 'mb', to: 'you', at: 85 },
  { from: 't', to: 'b', solid: true, at: 110 },
  { from: 'sig', to: 'b', solid: true, at: 124 },
  { from: 'mem', to: 'b', solid: true, at: 138 },
  { from: 'you', to: 'b', solid: true, at: 152 },
]

function Card({ title, note, children, className = '' }: { title: string; note: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-line bg-surface p-5 ${className}`}>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <span className="text-[12px] text-dim">{note}</span>
      </div>
      {children}
    </section>
  )
}
