import Link from 'next/link'
import { HoldingsBars } from '@/components/demo/HoldingsBars'
import { FlowGraph, type GraphEdge, type GraphNode } from '@/components/motion/FlowGraph'
import { readBaseWallet, type BaseWallet } from '@/lib/basePortfolio'
import { DEMO_WALLET, WATCHED } from '@/lib/baseWatch'
import { multibaasConfigured } from '@/lib/multibaas'
import { loadMemory, loadTreasury, SIGNALS, TREASURY, type Claim } from '@/lib/treasuryAgent'
import { manifestOf, NETWORK_NAME } from '@/lib/x402'
import type { AccessManifest } from '@knowledge01/repo'

export const metadata = { title: 'Demo — treasury dashboard' }
export const dynamic = 'force-dynamic'

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
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
          <h1 className="mt-2 text-[clamp(1.9rem,3.6vw,3rem)] font-semibold leading-[1.02] tracking-[-0.035em]">Know what you hold. Know what to do.</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form action="/demo/onchain" method="get" className="flex gap-2">
            <input name="wallet" defaultValue={wallet ?? ''} placeholder="Your Base wallet 0x…" spellCheck={false} className="w-[260px] rounded-xl border border-line bg-surface px-3 py-2 font-mono text-[13.5px] outline-none focus:border-ink/40" />
            <button className="rounded-xl border border-line px-4 py-2 text-[13.5px] hover:bg-raised">Load</button>
          </form>
          <Link href={`/demo/onchain/chat${wallet ? `?wallet=${wallet}` : ''}`} className="rounded-xl bg-ink px-4 py-2 text-[13.5px] text-bg hover:opacity-85">Ask Agent B →</Link>
        </div>
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
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead><tr className="text-left text-[12px] uppercase tracking-wide text-dim"><th className="py-2 font-normal">Wallet</th><th className="font-normal">Value</th><th className="font-normal">Stablecoins</th><th className="font-normal">Largest</th></tr></thead>
            <tbody className="divide-y divide-line">
              {watched.map((w) => (
                <tr key={w.address}>
                  <td className="py-2.5"><span className="font-medium">{w.label}</span> <span className="font-mono text-[12px] text-dim">{short(w.address)}</span></td>
                  <td className="font-mono">{usd(w.totalUsd)}</td>
                  <td>{pct(stablePct(w))}</td>
                  <td className="font-mono">{largest(w) ? `${largest(w)!.symbol} ${pct(largest(w)!.pct)}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      </div>

      <section className="mt-10">
        <h2 className="text-[18px] font-semibold tracking-[-0.02em]">How it works</h2>
        <p className="mb-4 mt-1 max-w-3xl text-[15px] leading-relaxed text-dim">Agent B <span className="text-[13px]">(Portfolio Intelligence)</span> always reads <Link href={`/k/${TREASURY}`} className="font-mono text-ink underline">{TREASURY}</Link>, which Agent A <span className="text-[13px]">(Market Scout)</span> writes. Give it an ENS name and it adds your memory on top: which wallets are yours, which you track, which coins you watch, what you spend and how much risk you take. It reads those wallets live on Base (balances through MultiBaas, history through Blockscout) and answers with a short report in which every figure is cited. When a question needs this week&apos;s whale flows, Agent B buys them: <Link href={`/k/${SIGNALS}`} className="font-mono text-ink underline">{SIGNALS}</Link> is sealed, and {signals?.offers?.[0]?.price ?? '$0.01'} USDC over x402 gets it a grant sealed to its own key until the week ends. That is cheaper than watching every transfer itself.</p>
        <FlowGraph cardH={150} nodes={NODES(treasury?.version, treasury?.claims.length, signals?.offers?.[0]?.price)} edges={EDGES} label="MultiBaas reads Base mainnet for Agent A (Market Scout), which writes prices, yields and whale readings to treasury.eth, and sealed 7-day whale flows to signals.treasury.eth. Agent B (Portfolio Intelligence) inherits treasury.eth, buys signals.treasury.eth over x402, adds your memory and your wallets, and answers with a report." />
        <HowItWorks treasury={treasury?.claims ?? []} version={treasury?.version} memory={demoMemory?.claims ?? []} memoryVersion={demoMemory?.version} watched={watched.length} signals={signals} />
      </section>
    </>
  )
}

const DEMO_MEMORY = 'personal.eth'
/** A reading without its date: the card already says when. */
/** Addresses shortened for reading; the claim itself keeps them whole. */
const shortAll = (c: string) => c.replace(/0x[0-9a-fA-F]{40}/g, (a) => short(a))
const undated = (c: string) => c.replace(/,?\s*(as of|on)\s+\d{1,2}\s+\w+\.?\s+\d{4}$/, '')

function HowItWorks({ treasury, version, memory, memoryVersion, watched, signals }: { treasury: Claim[]; version?: number; memory: Claim[]; memoryVersion?: number; watched: number; signals: AccessManifest | null }) {
  const offer = signals?.offers?.find((o) => o.role === 'read')
  const sales = (signals?.grants ?? []).filter((g) => g.payment)
  const of = (topic: string) => treasury.filter((c) => c.topic === topic)
  const prices = of('prices').map((c) => c.subject?.replace(/ price$/, '')).filter(Boolean)
  const byTopic = (t: string) => memory.filter((c) => c.topic === t)
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-3">
      <Card title="1 · Agent A writes" note={version ? `${TREASURY} v${version} · ${treasury.length} claims` : TREASURY}>
        <Group label="Prices and 24h moves">{prices.join(', ') || '—'}</Group>
        <Group label="Yields on Base">
          <ul className="space-y-1">{of('yields').map((c) => <li key={c.id}>{undated(c.claim)}</li>)}</ul>
        </Group>
        <Group label="Whale readings">{watched} large Base wallets, read through MultiBaas, plus a stablecoin benchmark</Group>
        <Group label="Playbook">{of('policy').map((c) => c.subject).join(', ') || '—'} · set by the owner, never by an agent</Group>
        <Group label={`Paid tier · ${SIGNALS}`}>
          {offer ? `Sealed 7-day whale flows. ${offer.price} ${offer.asset} per ${offer.epochDays}-day grant on ${NETWORK_NAME[offer.network] ?? offer.network}, paid to ${short(offer.payTo)} over x402.` : 'Not on sale.'}
          {sales.length ? <ul className="mt-1 space-y-0.5 text-[12.5px] text-dim">{sales.map((g) => <li key={g.id}>Sold to {g.agent} · {g.payment!.amount} {g.payment!.asset} · until {g.validUntil?.slice(0, 10)}</li>)}</ul> : null}
        </Group>
      </Card>

      <Card title="2 · Your memory adds" note={memoryVersion ? `example: ${DEMO_MEMORY} v${memoryVersion}` : 'optional'}>
        {memory.length ? (
          <>
            <Group label="Your wallet">{byTopic('wallets').map((c) => shortAll(c.claim)).join(' · ') || '—'}</Group>
            <Group label="Wallets you track"><ul className="space-y-1">{byTopic('tracking').map((c) => <li key={c.id}>{shortAll(c.claim)}</li>)}</ul></Group>
            <Group label="Coins you watch">{byTopic('watchlist').map((c) => c.claim).join(' · ') || '—'}</Group>
            <Group label="How you invest"><ul className="space-y-1">{byTopic('preferences').map((c) => <li key={c.id}>{c.claim}</li>)}</ul></Group>
          </>
        ) : <p className="text-[13.5px] text-dim">Any ENS name with memory under it. Its claims say which wallets are yours, which to track, which coins you watch and how you invest.</p>}
        <p className="mt-3 text-[12.5px] text-dim">Your preferences override the playbook where they differ.</p>
      </Card>

      <Card title="3 · Agent B answers" note="recommends; never signs">
        <Group label="Reads live on Base">Balances of 10 assets through MultiBaas, transaction history through Blockscout, for your wallets and the ones you track</Group>
        <Group label="Answers">Holdings, transactions, yield and historical activity, in plain questions</Group>
        <Group label="As a report">A one-line answer with the key number, then short sections: Holdings, Activity, Yield, Watchlist, What to consider</Group>
        <Group label="Buys what it lacks">When a question needs this week&apos;s whale flows, it pays Agent A over x402 for {SIGNALS}, once per epoch, and reads it with its own key</Group>
        <Group label="Cited">Every figure names its source: {TREASURY}, {SIGNALS}, your memory, or the wallet it was read from</Group>
        <Link href={`/demo/onchain/chat?name=${DEMO_MEMORY}`} className="mt-4 inline-block rounded-xl bg-ink px-4 py-2 text-[13.5px] text-bg hover:opacity-85">Try it with {DEMO_MEMORY} →</Link>
      </Card>
    </div>
  )
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-3 first:mt-0">
      <p className="text-[11.5px] uppercase tracking-wide text-dim">{label}</p>
      <div className="mt-0.5 text-[13.5px] leading-relaxed">{children}</div>
    </div>
  )
}

const NODES = (version?: number, claims?: number, price?: string): GraphNode[] => [
  { id: 'base', n: 1, title: 'Base mainnet', sub: 'Your wallets, and the large wallets Agent A watches.', x: 215, y: 190, icon: 'eye' },
  { id: 'mb', n: 2, title: 'MultiBaas', sub: 'Reads every balance on Base. No RPC node to run.', x: 215, y: 570, icon: 'calc' },
  { id: 'a', n: 3, title: 'Agent A', tag: 'Market Scout', sub: 'Watches whales, prices and yields; writes both tiers.', x: 650, y: 380, icon: 'agent' },
  { id: 't', n: 4, title: TREASURY, sub: version ? `Free · v${version} · ${claims} claims: prices, yields, whales.` : 'Free: prices, yields, whales, the playbook.', x: 1090, y: 95, icon: 'flag', href: `/k/${TREASURY}` },
  { id: 'sig', n: 5, title: SIGNALS, w: 400, sub: `Sealed whale flows. Agent B pays ${price ?? '$0.01'} over x402 per week.`, x: 1090, y: 285, icon: 'lock', href: `/k/${SIGNALS}` },
  { id: 'mem', n: 6, title: 'Your memory', sub: 'yourname.eth: wallets you track, coins you watch.', x: 1090, y: 475, icon: 'name' },
  { id: 'you', n: 7, title: 'Your wallets', sub: 'Balances via MultiBaas, history via Blockscout.', x: 1090, y: 665, icon: 'key' },
  { id: 'b', n: 8, title: 'Agent B', tag: 'Portfolio Intelligence', w: 420, sub: 'Inherits treasury.eth, buys signals, adds your memory, reports.', x: 1535, y: 380, icon: 'agent', final: true },
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
