/**
 * The monochrome building blocks the protocol pages are made of.
 *
 * Drawn from one reference and kept to its rules: full width with a fixed
 * gutter, a hairline over every section, a small label on the left against a
 * large paragraph on the right, headlines in a tight grotesque with the period
 * left on, black pills with an arrow, and rounded media set in grey. Colour is
 * black, white and grey; emphasis is weight and opacity, never hue.
 */
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Arrow } from '@/components/Arrow'

export const GUTTER = 'px-5 sm:px-8 lg:px-10'

/** The two-square mark. Two blocks meeting at a corner: two agents, one name. */
export function Mark({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      <rect x="18" y="0" width="22" height="20" rx="3.5" className="fill-[hsl(var(--ink))]" />
      <rect x="0" y="18" width="22" height="22" rx="3.5" className="fill-[hsl(var(--ink))]" />
    </svg>
  )
}

/** A full-width section with the reference's hairline on top. */
export function Section({ children, className = '', rule = true, id }: { children: ReactNode; className?: string; rule?: boolean; id?: string }) {
  return (
    <section id={id} className={`w-full ${GUTTER} ${className}`}>
      <div className={`${rule ? 'border-t border-line' : ''} py-16 sm:py-24`}>{children}</div>
    </section>
  )
}

/** Headline: tight grotesque, sentence case, the period kept. */
export function Title({ children, size = 'md', className = '', as = 'h2' }: { children: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl'; className?: string; as?: 'h1' | 'h2' | 'h3' }) {
  const scale = {
    sm: 'text-[clamp(1.7rem,2.8vw,2.4rem)]',
    md: 'text-[clamp(2.3rem,4.6vw,4.2rem)]',
    lg: 'text-[clamp(2.9rem,6.4vw,6rem)]',
    xl: 'text-[clamp(3.6rem,9vw,8.6rem)]',
  }[size]
  const Tag = as
  return <Tag className={`font-display font-normal leading-[0.94] tracking-[-0.025em] ${scale} ${className}`}>{children}</Tag>
}

/** The small two-line label that sits on the left of a split section. */
export function Label({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`text-[14px] leading-[1.25] tracking-[-0.01em] text-ink ${className}`}>{children}</p>
}

/** A large paragraph, set as prose rather than as a heading. */
export function Lead({ children, tone = 'ink', className = '' }: { children: ReactNode; tone?: 'ink' | 'dim'; className?: string }) {
  return (
    <p className={`font-sans font-light text-[clamp(1.25rem,2.1vw,2rem)] leading-[1.3] tracking-[-0.015em] ${tone === 'dim' ? 'text-dim' : 'text-ink'} ${className}`}>
      {children}
    </p>
  )
}

/** Label left, paragraph right — the reference's introduction. */
export function Split({ label, children, action }: { label: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <Label>{label}</Label>
      <div>
        {children}
        {action ? <div className="mt-8">{action}</div> : null}
      </div>
    </div>
  )
}

/** Headline left, grey paragraph right — the reference's statement. */
export function Statement({ title, children, action }: { title: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="grid gap-10 lg:grid-cols-2">
      <Title size="md">{title}</Title>
      <div>
        <Lead tone="dim">{children}</Lead>
        {action ? <div className="mt-9">{action}</div> : null}
      </div>
    </div>
  )
}

/** A black pill with an arrow. The only button shape these pages use. */
export function Pill({ href, children, tone = 'ink', size = 'md' }: { href: string; children: ReactNode; tone?: 'ink' | 'line'; size?: 'sm' | 'md' }) {
  const t = tone === 'ink' ? 'bg-ink text-bg hover:opacity-85' : 'border border-line text-ink hover:bg-raised'
  const s = size === 'sm' ? 'px-3.5 py-1.5 text-[13.5px]' : 'px-6 py-3.5 text-[15px]'
  return (
    <Link href={href} className={`group inline-flex items-center gap-3 rounded-full ${t} ${s} tracking-[-0.01em] transition`}>
      {children}
      <Arrow />
    </Link>
  )
}

/**
 * Rounded media in grey, with its caption set inside the top-left corner.
 *
 * A placeholder until real footage exists: a soft grey gradient and a play
 * button, so the layout is right and nothing pretends to be a screenshot.
 */
export function Media({ title, sub, className = 'aspect-[16/7]', play = true, children }: { title?: string; sub?: string; className?: string; play?: boolean; children?: ReactNode }) {
  return (
    <div className={`relative w-full overflow-hidden rounded-[28px] bg-[linear-gradient(120deg,hsl(var(--ink)/0.16),hsl(var(--ink)/0.05)_55%,hsl(var(--ink)/0.1))] ${className}`}>
      <div className="absolute inset-0 bg-[radial-gradient(60%_80%_at_30%_40%,hsl(var(--bg)/0.55),transparent_70%)]" aria-hidden />
      {children}
      {title ? (
        <p className="absolute left-6 top-5 text-[14.5px] leading-[1.25] tracking-[-0.01em] text-ink">
          {title}
          {sub ? <><br /><span className="text-ink/55">{sub}</span></> : null}
        </p>
      ) : null}
      {play ? (
        <span className="absolute bottom-5 left-1/2 flex h-11 w-11 -translate-x-1/2 items-center justify-center rounded-full bg-bg text-[12px] text-ink shadow-sm" aria-hidden>▶</span>
      ) : null}
    </div>
  )
}

/** A number set enormous, a unit in brackets beside it, and a caption under a rule. */
export function Spec({ value, unit, label, children }: { value: string; unit?: string; label: string; children: ReactNode }) {
  return (
    <div>
      <p className="flex items-start gap-1.5 font-display text-[clamp(3.2rem,6vw,5.6rem)] font-normal leading-[0.9] tracking-[-0.05em]">
        {value}
        {unit ? <span className="mt-2 text-[13.5px] tracking-normal text-dim">({unit})</span> : null}
      </p>
      <div className="mt-5 border-t border-line pt-3">
        <p className="text-[12.5px] text-dim">{label}</p>
        <p className="mt-1 max-w-[30ch] text-[14px] leading-snug text-dim">{children}</p>
      </div>
    </div>
  )
}

/** A card in the "see it in action" row: grey media, a two-line title, a round plus. */
export function ActionCard({ title, sub, body, href }: { title: string; sub: string; body: string; href?: string }) {
  return (
    <details className="group w-[82vw] shrink-0 snap-start sm:w-[44vw] lg:w-[31vw] [&_summary::-webkit-details-marker]:hidden">
      <summary className="list-none cursor-pointer">
        <Media className="aspect-[4/3]" play={false} />
        <p className="mt-4 text-[clamp(1.2rem,1.8vw,1.7rem)] leading-[1.08] tracking-[-0.035em]">
          {title}
          <br />
          {sub}
        </p>
        <span className="mt-6 flex h-12 w-12 items-center justify-center rounded-full bg-raised text-[22px] font-light text-dim transition-transform group-open:rotate-45" aria-hidden>+</span>
      </summary>
      <p className="mt-4 max-w-md text-[14px] leading-relaxed text-dim">
        {body}
        {href ? <> <Link href={href} className="text-ink underline-offset-4 hover:underline">More <Arrow /></Link></> : null}
      </p>
    </details>
  )
}

/** A row of accordion items: a dot, a title, a dash; open shows the text. */
export function Firsts({ items }: { items: { title: string; body: string }[] }) {
  return (
    <div className="divide-y divide-line border-y border-line">
      {items.map((it, i) => (
        <details key={it.title} open={i === 0} className="group py-5 [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex cursor-pointer list-none items-center gap-3 text-[16px] tracking-[-0.015em]">
            <span className="h-2 w-2 rounded-full bg-ink" aria-hidden />
            {it.title}
            <span className="ml-auto h-px w-4 bg-ink transition-opacity group-open:opacity-100 opacity-40" aria-hidden />
          </summary>
          <p className="mt-3 max-w-md pl-5 text-[14.5px] leading-relaxed text-dim">{it.body}</p>
        </details>
      ))}
    </div>
  )
}

/** The giant wordmark, set against the mark. */
export function Wordmark({ text }: { text: string }) {
  return (
    <div className="flex items-end justify-between gap-6 overflow-hidden">
      <p className="select-none font-display font-normal leading-[0.78] tracking-[-0.06em]" style={{ fontSize: 'clamp(5rem, 24vw, 26rem)' }}>{text}</p>
      <Mark className="mb-[1.5vw] h-[clamp(4rem,19vw,20rem)] w-[clamp(4rem,19vw,20rem)] shrink-0" />
    </div>
  )
}
