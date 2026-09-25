import Link from 'next/link'
import { FlowGraph, type GraphEdge, type GraphNode } from '@/components/motion/FlowGraph'
import { loadTreasury, TREASURY, type Claim } from '@/lib/treasuryAgent'

export const metadata = { title: 'Demo — treasury agents' }
export const dynamic = 'force-dynamic'

const TOPICS: { id: string; label: string }[] = [
  { id: 'policy', label: 'Playbook' },
  { id: 'prices', label: 'Prices' },
  { id: 'treasuries', label: 'Treasuries' },
  { id: 'flows', label: 'Flows' },
  { id: 'benchmarks', label: 'Benchmarks' },
]

export default async function TreasuryDemo() {
  const treasury = await loadTreasury()
  const claims = treasury?.claims ?? []

  const nodes: GraphNode[] = [
    { id: 'whales', n: 1, title: 'Whale treasuries', sub: 'ENS DAO · Uniswap · Nouns · vitalik', x: 215, y: 190, icon: 'eye' },
    { id: 'prices', n: 2, title: 'Price feed', sub: 'CoinGecko · ETH, BTC', x: 215, y: 570, icon: 'calc' },
    { id: 'a', n: 3, title: 'Agent A · watcher', sub: 'reads, writes sourced claims', x: 650, y: 380, icon: 'agent' },
    { id: 'treasury', n: 4, title: TREASURY, sub: treasury ? `v${treasury.version} · ${claims.length} claims · ENS → IPFS` : 'ENS → IPFS', x: 1090, y: 190, icon: 'flag' },
    { id: 'you', n: 5, title: 'yourname.eth', sub: 'your memory + your wallet', x: 1090, y: 570, icon: 'key' },
    { id: 'b', n: 6, title: 'Agent B · treasury', sub: 'answers and recommends', x: 1540, y: 380, icon: 'agent', final: true },
  ]
  const edges: GraphEdge[] = [
    { from: 'whales', to: 'a', at: 10 },
    { from: 'prices', to: 'a', at: 24 },
    { from: 'a', to: 'treasury', at: 72 },
    { from: 'treasury', to: 'b', solid: true, at: 130 },
    { from: 'you', to: 'b', solid: true, at: 146 },
  ]

  return (
    <>
      <header className="mb-8 flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-3xl">
          <p className="text-[12px] uppercase tracking-[0.12em] text-dim">Demo · on-chain</p>
          <h1 className="mt-2 text-[clamp(2rem,4vw,3.2rem)] font-semibold leading-[1.02] tracking-[-0.035em]">Two agents, one memory, on ENS.</h1>
          <p className="mt-4 text-[16px] leading-relaxed text-dim">
            Agent A watches well-known treasuries and a price feed, and writes what it sees into <span className="font-mono text-ink">{TREASURY}</span>.
            Agent B, your treasury agent, reads that memory, adds yours from your own ENS name, and answers — recommending actions from your balances,
            your liquidity needs and the playbook. Neither agent talks to the other: the memory in between is the only link.
          </p>
        </div>
        <Link href="/demo/onchain/chat" className="rounded-full bg-ink px-6 py-3 text-[15px] text-bg transition-opacity hover:opacity-85">Try now →</Link>
      </header>

      <FlowGraph nodes={nodes} edges={edges} label={`Whale treasuries and a price feed feed Agent A, which writes to ${TREASURY}; Agent B reads ${TREASURY} and your own ENS memory, then answers.`} />

      <ol className="mt-8 grid gap-4 md:grid-cols-4">
        {[
          ['Agent A reads', 'Balances and transfers of five treasuries on Ethereum mainnet, and prices from CoinGecko.'],
          ['…and writes', `Each reading becomes a claim in ${TREASURY} with its source. A newer reading supersedes the last; history keeps both.`],
          ['You bring yours', 'Enter your ENS name. Agent B loads the memory under it and the wallet that owns it, plus any wallet you add.'],
          ['Agent B answers', 'From those three only, citing each point — and recommends; it never signs or sends.'],
        ].map(([t, b], i) => (
          <li key={t} className="rounded-2xl border border-line bg-surface p-4">
            <p className="text-[12px] text-dim">{i + 1}</p>
            <p className="mt-1 text-[15px] font-semibold">{t}</p>
            <p className="mt-1 text-[13.5px] leading-relaxed text-dim">{b}</p>
          </li>
        ))}
      </ol>

      <section className="mt-12">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-[20px] font-semibold tracking-[-0.02em]">What Agent A has written to <span className="font-mono">{TREASURY}</span></h2>
          {treasury ? <Link href={`/k/${TREASURY}`} className="text-[13.5px] text-dim underline hover:text-ink">v{treasury.version} · open in the explorer</Link> : null}
        </div>
        {!treasury ? (
          <p className="rounded-2xl border border-dashed border-line p-6 text-[14.5px] text-dim">{TREASURY} could not be read from ENS right now.</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {TOPICS.map((t) => {
              const items = claims.filter((c) => c.topic === t.id)
              return items.length ? <TopicCard key={t.id} label={t.label} items={items} /> : null
            })}
          </div>
        )}
      </section>

      <div className="mt-12 flex flex-wrap items-center justify-between gap-4 rounded-[22px] bg-ink p-6 text-bg">
        <div>
          <p className="text-[18px] font-semibold">Bring your own memory</p>
          <p className="text-[14px] text-bg/70">Enter your ENS name and ask Agent B about your holdings, or what the playbook says you should do.</p>
        </div>
        <Link href="/demo/onchain/chat" className="rounded-full bg-bg px-6 py-3 text-[15px] text-ink transition-opacity hover:opacity-85">Try now →</Link>
      </div>
    </>
  )
}

function TopicCard({ label, items }: { label: string; items: Claim[] }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <p className="text-[12px] uppercase tracking-[0.12em] text-dim">{label}</p>
      <ul className="mt-3 space-y-3">
        {items.map((c) => (
          <li key={c.id}>
            <p className="text-[14.5px] leading-snug">{c.claim}</p>
            <p className="mt-0.5 text-[12.5px] text-dim">{c.sources.join(' · ') || 'no source'} · by {c.contributor}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}
