import Link from 'next/link'

export const metadata = { title: 'Demos' }

const DEMOS = [
  {
    href: '/demo/onchain',
    n: '01',
    kicker: 'Blockchain',
    motif: ['Agent A', 'treasury.eth', 'Agent B'],
    title: 'Portfolio intelligence',
    body: 'Ask your Base portfolio anything; two agents share one memory.',
    reads: ['treasury.eth', 'Base via MultiBaas', 'your ENS name'],
    meta: '2 min · no wallet needed',
    cta: 'See the flow',
  },
  {
    href: '/app?start=1',
    n: '02',
    kicker: 'Personal memory',
    motif: ['GitHub · Google', 'you.eth'],
    title: 'Owned Instinct',
    body: 'Memory from your apps, under a name you own.',
    reads: ['GitHub', 'Google', 'Granola', 'your wallet'],
    meta: '5 min · a wallet on Sepolia',
    cta: 'Start with a source',
  },
  {
    href: '/demo/mcp',
    n: '03',
    kicker: 'Your terminal',
    motif: ['$ npx -y @knowledge01/mcp'],
    title: 'MCP in action',
    body: 'Your agent reading ENS, from your terminal.',
    reads: ['cancer-research.eth', 'IPFS', '@knowledge01/mcp'],
    meta: '3 min · Node 22 and Claude Code',
    cta: 'Open the steps',
  },
]

export default function Demos() {
  return (
    <div className="flex min-h-[calc(100vh-9rem)] flex-col">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[12px] uppercase tracking-[0.12em] text-dim">Demos</p>
          <h1 className="mt-2 text-[clamp(2rem,4vw,3.2rem)] font-normal leading-[1.02] tracking-[-0.02em]">See the network working.</h1>
        </div>
        <p className="text-[15px] text-dim">Three ways in. All real data.</p>
      </header>

      <div className="grid flex-1 gap-4 lg:grid-cols-3">
        {DEMOS.map((d) => (
          <Link key={d.href} href={d.href} className="group flex min-h-[460px] flex-col rounded-[26px] border border-line bg-surface p-7 transition-colors hover:border-ink/40">
            <div className="flex items-center justify-between">
              <span className="text-[12px] uppercase tracking-[0.12em] text-dim">{d.kicker}</span>
              <span className="font-mono text-[13px] text-dim">{d.n}</span>
            </div>
            <div className="flex flex-1 items-center justify-center py-8" aria-hidden>
              <div className="flex flex-wrap items-center justify-center gap-2 font-mono text-[13px]">
                {d.motif.map((m, i) => (
                  <span key={m} className="flex items-center gap-2">
                    {i ? <span className="text-dim">→</span> : null}
                    <span className={`rounded-xl border px-3 py-2 ${i === d.motif.length - 1 ? 'border-ink bg-ink text-bg' : 'border-line bg-raised/60 text-ink/80'}`}>{m}</span>
                  </span>
                ))}
              </div>
            </div>
            <h2 className="font-display text-[clamp(2rem,3vw,2.8rem)] font-normal leading-[1.02] tracking-[-0.02em]">{d.title}</h2>
            <p className="mt-3 text-[16px] text-dim">{d.body}</p>
            <div className="mt-5 flex flex-wrap gap-1.5">
              {d.reads.map((r) => <span key={r} className="rounded-full border border-line px-2.5 py-1 font-mono text-[12px] text-ink/70">{r}</span>)}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-8">
              <span className="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-[14px] text-bg transition-opacity group-hover:opacity-85">{d.cta} →</span>
              <span className="text-[13px] text-dim">{d.meta}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
