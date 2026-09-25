import Link from 'next/link'
import { PageHeader } from '@/components/ui'

export const metadata = { title: 'Demos' }

const DEMOS = [
  {
    href: '/demo/onchain',
    kicker: 'Blockchain',
    title: 'Treasury agents',
    body: 'Agent A watches whale treasuries and prices and writes to treasury.eth. Bring your own ENS memory, and Agent B reads both to answer about your holdings and recommend what to do.',
    cta: 'See the flow',
  },
  {
    href: '/app?start=1',
    kicker: 'Personal memory',
    title: 'Owned Instinct',
    body: 'An agent that learns you from the apps you already use — like Instinct, except the memory is under an ENS name you own, every claim cites its source, and any agent you grant can read it.',
    cta: 'Start with a source',
  },
  {
    href: '/demo/mcp',
    kicker: 'Your terminal',
    title: 'MCP in action',
    body: 'Install the MCP server, point your agent at a live namespace on ENS, and ask it questions. Follow the steps in your own terminal while the recording plays beside them.',
    cta: 'Open the steps',
  },
]

export default function Demos() {
  return (
    <>
      <PageHeader title="Demos" subtitle="Three ways to see the knowledge network working. Each one reads real data — nothing on these pages is a mock-up." />
      <div className="grid gap-4 lg:grid-cols-3">
        {DEMOS.map((d) => (
          <Link key={d.href} href={d.href} className="group flex flex-col rounded-[22px] border border-line bg-surface p-6 transition-colors hover:border-ink/40">
            <span className="text-[12px] uppercase tracking-[0.12em] text-dim">{d.kicker}</span>
            <span className="mt-3 text-[22px] font-semibold tracking-[-0.02em]">{d.title}</span>
            <span className="mt-2 flex-1 text-[14.5px] leading-relaxed text-dim">{d.body}</span>
            <span className="mt-6 inline-flex w-fit items-center gap-2 rounded-full bg-ink px-4 py-2 text-[13.5px] text-bg transition-opacity group-hover:opacity-85">{d.cta} →</span>
          </Link>
        ))}
      </div>
    </>
  )
}
