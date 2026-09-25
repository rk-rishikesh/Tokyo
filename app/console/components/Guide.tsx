import Link from 'next/link'
import type { ReactNode } from 'react'
import { Footer as SiteFooter } from '@/components/landing/Sections'
import { Arrow } from '@/components/Arrow'

/**
 * Shared building blocks for the protocol pages. Server-safe.
 *
 * Same grammar as the landing page: a hairline over every section, a title on
 * the left against grey prose on the right, numbered hairline lists instead of
 * boxed cards, and monochrome throughout.
 */

export function Hero({ kicker, title, sub, actions }: { kicker: string; title: string; sub: string; actions?: ReactNode }) {
  return (
    <section className="w-full px-5 pb-14 pt-14 sm:px-8 sm:pt-20 lg:px-10">
      <p className="text-[14px] leading-tight text-ink">{kicker}</p>
      <div className="mt-6 grid gap-10 lg:grid-cols-2">
        <h1 className="text-balance font-display text-[clamp(2.8rem,6.4vw,6rem)] font-normal leading-[0.94] tracking-[-0.045em]">{title}</h1>
        <div>
          <p className="text-pretty font-display text-[clamp(1.3rem,2.2vw,2.1rem)] leading-[1.14] tracking-[-0.035em] text-dim">{sub}</p>
          {actions ? <div className="mt-9 flex flex-wrap gap-3">{actions}</div> : null}
        </div>
      </div>
    </section>
  )
}

export function Section({ title, intro, children, id }: { title: string; intro?: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="border-t border-line py-16 sm:py-20">
      <div className="mb-10 grid gap-6 lg:grid-cols-2">
        <h2 className="font-display text-[clamp(1.8rem,3.2vw,2.9rem)] font-normal leading-[0.98] tracking-[-0.045em]">{title}</h2>
        {intro ? <p className="max-w-2xl text-[15px] leading-relaxed text-dim">{intro}</p> : null}
      </div>
      {children}
    </section>
  )
}

export function Steps({ steps }: { steps: { title: string; body: ReactNode; code?: string }[] }) {
  return (
    <ol className="border-t border-line">
      {steps.map((s, i) => (
        <li key={i} className="grid gap-4 border-b border-line py-7 md:grid-cols-[4rem_1fr_1.2fr]">
          <span className="font-mono text-[13.5px] text-dim">{String(i + 1).padStart(2, '0')}</span>
          <div>
            <h3 className="text-[clamp(1.15rem,1.7vw,1.5rem)] leading-tight tracking-[-0.03em]">{s.title}</h3>
            <div className="mt-2 text-[14px] leading-relaxed text-dim">{s.body}</div>
          </div>
          {s.code ? (
            <pre className="overflow-x-auto rounded-2xl bg-raised p-4 font-mono text-[13.5px] leading-relaxed text-ink/85"><code>{s.code}</code></pre>
          ) : <span />}
        </li>
      ))}
    </ol>
  )
}

export function Diagram({ children, caption }: { children: string; caption?: string }) {
  return (
    <figure className="rounded-[28px] bg-canvas p-6 [background-image:radial-gradient(hsl(var(--ink)/0.12)_1px,transparent_1px)] [background-size:20px_20px]">
      <pre className="overflow-x-auto font-mono text-[14px] leading-relaxed text-ink/85"><code>{children}</code></pre>
      {caption ? <figcaption className="mt-4 text-[13.5px] text-dim">{caption}</figcaption> : null}
    </figure>
  )
}

export function Callout({ title, children, tone = 'accent' }: { title: string; children: ReactNode; tone?: 'accent' | 'plain' }) {
  return (
    <div className={`rounded-[28px] p-8 ${tone === 'accent' ? 'bg-ink text-bg' : 'bg-raised'}`}>
      <h3 className="font-display text-[clamp(1.4rem,2.2vw,2rem)] font-normal leading-tight tracking-[-0.04em]">{title}</h3>
      <div className={`mt-4 max-w-3xl space-y-3 text-[14.5px] leading-relaxed ${tone === 'accent' ? 'text-bg/75' : 'text-dim'}`}>{children}</div>
    </div>
  )
}

export function Facts({ items }: { items: { k: string; v: ReactNode }[] }) {
  return (
    <div className="grid border-t border-line sm:grid-cols-2">
      {items.map((f) => (
        <div key={f.k} className="border-b border-line py-6 sm:pr-10">
          <p className="text-[13px] text-dim">{f.k}</p>
          <div className="mt-2 text-[15px] leading-relaxed tracking-[-0.01em]">{f.v}</div>
        </div>
      ))}
    </div>
  )
}

/** A black pill with an arrow — the one button shape these pages use. */
export function Action({ href, children, tone = 'ink' }: { href: string; children: ReactNode; tone?: 'ink' | 'line' }) {
  return (
    <Link href={href} className={`group inline-flex items-center gap-3 rounded-full px-6 py-3.5 text-[15px] transition ${tone === 'ink' ? 'bg-ink text-bg hover:opacity-85' : 'border border-line hover:bg-raised'}`}>
      {children} <Arrow />
    </Link>
  )
}

/**
 * The site footer. The protocol pages end on the same wordmark as the landing
 * page; a page wrapped in a gutter breaks out of it to run full width.
 */
export const Footer = () => (
  <div className="-mx-5 mt-16 sm:-mx-8 lg:-mx-10">
    <SiteFooter />
  </div>
)

export type Stage = { title: string; sub?: string; note?: { label: string; items: string[] } }

/**
 * A pipeline as stages, not as ASCII: cards joined by arrowed wires, a dot
 * travelling the length of it, and notes hanging off the stages they explain.
 * The last stage is set in ink because it is where the object ends up.
 *
 * CSS only, so it is server-rendered and animates before hydration. Below the
 * large breakpoint it stacks vertically and the wires turn to follow.
 */
export function Pipeline({ stages, caption }: { stages: Stage[]; caption?: string }) {
  return (
    <figure className="rounded-[28px] bg-canvas p-6 sm:p-8 [background-image:radial-gradient(hsl(var(--ink)/0.1)_1px,transparent_1px)] [background-size:20px_20px]">
      <ol className="grid gap-3 lg:grid-flow-col lg:auto-cols-fr lg:gap-0">
        {stages.map((s, i) => {
          const last = i === stages.length - 1
          return (
            <li key={s.title} className="relative flex flex-col lg:pr-8">
              <div className={`relative z-10 min-h-[7.5rem] rounded-[18px] border px-4 py-4 ${last ? 'border-ink bg-ink text-bg' : 'border-line bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.03),0_10px_24px_-18px_rgba(0,0,0,0.3)]'}`}>
                <p className={`font-mono text-[12px] ${last ? 'text-bg/55' : 'text-dim'}`}>{String(i + 1).padStart(2, '0')}</p>
                <p className="mt-2 text-[15px] font-medium leading-tight tracking-[-0.02em]">{s.title}</p>
                {s.sub ? <p className={`mt-1 text-[13.5px] leading-snug ${last ? 'text-bg/65' : 'text-dim'}`}>{s.sub}</p> : null}
              </div>

              {/* The wire to the next stage: horizontal on wide screens, vertical when stacked. */}
              {!last ? (
                <>
                  <span aria-hidden className="kn-pipe-h pointer-events-none absolute right-0 top-[2.1rem] hidden h-px w-8 lg:block" />
                  <span aria-hidden className="kn-pipe-v pointer-events-none mx-auto block h-3 w-px lg:hidden" />
                </>
              ) : null}

              {s.note ? (
                <div className="relative mt-0 lg:mt-0">
                  <span aria-hidden className="ml-6 block h-6 w-px border-l border-dashed border-ink/25" />
                  <div className="rounded-2xl border border-dashed border-ink/20 bg-bg/70 px-3.5 py-3">
                    <p className="text-[12.5px] text-dim">{s.note.label}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {s.note.items.map((it) => (
                        <span key={it} className="rounded-full bg-raised px-2.5 py-1 font-mono text-[12px] text-ink/75">{it}</span>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </li>
          )
        })}
      </ol>
      {caption ? <figcaption className="mt-6 text-[14px] text-dim">{caption}</figcaption> : null}
    </figure>
  )
}

/** The wrong way and the right way, side by side, with the reason under both. */
export function Contrast({ wrong, right, why }: { wrong: { title: string; items: string[] }; right: { title: string; items: string[] }; why: ReactNode }) {
  const Col = ({ tone, title, items }: { tone: 'wrong' | 'right'; title: string; items: string[] }) => (
    <div className={`rounded-[22px] p-6 ${tone === 'right' ? 'bg-ink text-bg' : 'border border-line bg-surface'}`}>
      <div className="flex items-center gap-2.5">
        <span className={`flex h-7 w-7 items-center justify-center rounded-full text-[14.5px] ${tone === 'right' ? 'bg-bg text-ink' : 'bg-raised text-dim'}`} aria-hidden>{tone === 'right' ? '✓' : '✕'}</span>
        <p className="text-[15px] tracking-[-0.02em]">{title}</p>
      </div>
      <ul className="mt-5 space-y-2.5">
        {items.map((it) => (
          <li key={it} className={`font-mono text-[14px] leading-relaxed ${tone === 'right' ? 'text-bg/85' : 'text-dim line-through decoration-ink/25'}`}>{it}</li>
        ))}
      </ul>
    </div>
  )
  return (
    <div>
      <div className="grid gap-4 md:grid-cols-2">
        <Col tone="wrong" {...wrong} />
        <Col tone="right" {...right} />
      </div>
      <div className="mt-5 max-w-3xl text-[14px] leading-relaxed text-dim">{why}</div>
    </div>
  )
}

export type FlowStep = { title: string; sub: string; via?: string; strong?: boolean }

/**
 * A request travelling down a stack: one node per system it passes through,
 * and on each wire what it carries. The first and last nodes are in ink —
 * where the request starts and what comes back.
 */
export function CallFlow({ steps }: { steps: FlowStep[] }) {
  return (
    <figure className="h-full rounded-[28px] bg-canvas p-6 sm:p-8 [background-image:radial-gradient(hsl(var(--ink)/0.1)_1px,transparent_1px)] [background-size:20px_20px]">
      <ol className="flex flex-col">
        {steps.map((s, i) => (
          <li key={s.title} className="flex flex-col">
            <div className={`rounded-[18px] px-5 py-4 ${s.strong ? 'bg-ink text-bg' : 'border border-line bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.03),0_10px_24px_-18px_rgba(0,0,0,0.3)]'}`}>
              <div className="flex items-baseline gap-3">
                <span className={`font-mono text-[12px] ${s.strong ? 'text-bg/55' : 'text-dim'}`}>{String(i + 1).padStart(2, '0')}</span>
                <p className="text-[16px] font-medium tracking-[-0.02em]">{s.title}</p>
              </div>
              <p className={`mt-1 pl-8 text-[13.5px] leading-snug ${s.strong ? 'text-bg/65' : 'text-dim'}`}>{s.sub}</p>
            </div>
            {i < steps.length - 1 ? (
              <div className="flex items-stretch gap-4 pl-8">
                <span aria-hidden className="kn-flow-v relative block w-px bg-ink/30" />
                <p className="py-3 font-mono text-[12.5px] leading-snug text-dim">{steps[i + 1]!.via ?? ''}</p>
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </figure>
  )
}
