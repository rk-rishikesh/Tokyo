'use client'

import Link from 'next/link'
import { Footer } from '@/components/Guide'
import { StickyToggle } from '@/components/StickyToggle'
import { useMode } from '@/components/ModeContext'
import { ROWS, THESIS, VERDICT, type Row } from '@/content/compare'

const EDGE: Record<Row['edge'], { label: string; className: string }> = {
  memory: { label: 'differs here', className: 'bg-accent/10 text-accent' },
  github: { label: 'GitHub wins', className: 'bg-raised text-dim' },
  even: { label: 'roughly even', className: 'bg-raised text-dim' },
}

export default function ComparePage() {
  const { mode } = useMode()
  const thesis = THESIS[mode]
  const verdict = VERDICT[mode]

  const differs = ROWS.filter((r) => r.edge === 'memory')
  const rest = ROWS.filter((r) => r.edge !== 'memory')

  return (
    <>
      <section className="w-full px-5 pb-12 pt-14 sm:px-8 sm:pt-20 lg:px-10">
        <p className="text-[14px] leading-tight text-ink">The obvious<br />question.</p>
        <h1 key={`t-${mode}`} className="relabel mt-6 max-w-[18ch] text-balance font-display text-[clamp(2.6rem,6vw,5.6rem)] font-normal leading-[0.94] tracking-[-0.045em]">
          {thesis.title}
        </h1>
      </section>

      <StickyToggle />

      <main className="w-full px-5 sm:px-8 lg:px-10">
        <section className="space-y-4 py-12">
          {thesis.body.map((p, i) => (
            <p
              key={`${mode}-${i}`}
              className="relabel text-pretty text-[15px] leading-relaxed text-ink/85"
            >
              {p}
            </p>
          ))}
        </section>

        {/* The rows that actually differ. */}
        <section className="border-t border-line py-12">
          <h2 className="text-xl font-semibold tracking-tight">Where it differs</h2>
          <p className="mt-2 max-w-2xl text-[14.5px] leading-relaxed text-dim">
            Every one of these reduces to the same two things: the unit of change is a fact,
            not a line — and the remote is a name you own, not an account.
          </p>
          <div className="mt-6 space-y-3">
            {differs.map((row) => (
              <Comparison key={row.question} row={row} mode={mode} />
            ))}
          </div>
        </section>

        {/* The rows where it does not. Stated just as plainly. */}
        <section className="border-t border-line py-12">
          <h2 className="text-xl font-semibold tracking-tight">Where GitHub wins</h2>
          <p className="mt-2 max-w-2xl text-[14.5px] leading-relaxed text-dim">
            A comparison that only listed our advantages would not be worth reading. These
            are real, and one of them is not close.
          </p>
          <div className="mt-6 space-y-3">
            {rest.map((row) => (
              <Comparison key={row.question} row={row} mode={mode} />
            ))}
          </div>
        </section>

        {/* Verdict */}
        <section className="border-t border-line py-12">
          <h2 className="mb-6 text-xl font-semibold tracking-tight">So which should you use?</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-accent/30 bg-accent-soft p-5">
              <h3 className="text-[15px] font-semibold">Use this when…</h3>
              <p key={`u-${mode}`} className="relabel mt-2 text-[14.5px] leading-relaxed text-ink/85">
                {verdict.use}
              </p>
            </div>
            <div className="rounded-xl border border-line bg-surface p-5">
              <h3 className="text-[15px] font-semibold">Use GitHub when…</h3>
              <p key={`i-${mode}`} className="relabel mt-2 text-[14.5px] leading-relaxed text-ink/85">
                {verdict.instead}
              </p>
            </div>
          </div>
        </section>

        <section className="border-t border-line py-12">
          <Link
            href="/protocol"
            className="inline-flex items-center gap-2 rounded-full border border-line px-5 py-3 text-[14px] transition hover:bg-raised"
          >
            ← back to the protocol
          </Link>
        </section>

        <Footer />
      </main>
    </>
  )
}

function Comparison({ row, mode }: { row: Row; mode: 'ens' | 'plain' }) {
  const edge = EDGE[row.edge]
  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold">{row.question}</h3>
        <span className={`rounded px-2 py-0.5 text-[12.5px] font-medium ${edge.className}`}>
          {edge.label}
        </span>
      </div>
      <dl className="grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="mb-1 text-[12.5px] font-medium uppercase tracking-wider text-dim">
            GitHub
          </dt>
          <dd className="text-[14.5px] leading-relaxed text-ink/80">{row.github}</dd>
        </div>
        <div className="sm:border-l sm:border-line sm:pl-4">
          <dt className="mb-1 text-[12.5px] font-medium uppercase tracking-wider text-accent">
            Knowledge network
          </dt>
          <dd
            key={`${row.question}-${mode}`}
            className="relabel text-[14.5px] leading-relaxed text-ink/80"
          >
            {row.memory[mode]}
          </dd>
        </div>
      </dl>
    </div>
  )
}
