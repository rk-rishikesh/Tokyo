import type { ReactNode } from 'react'

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`kn-card rounded-lg border border-border bg-card ${className}`}>{children}</div>
  )
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'added' | 'removed' | 'warn' | 'accent'
}) {
  const tones = {
    neutral: 'bg-muted text-muted-foreground',
    added: 'bg-added-bg text-added',
    removed: 'bg-removed-bg text-removed',
    warn: 'bg-warn-bg text-warn',
    accent: 'bg-accent/10 text-accent',
  } as const
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-[13.5px] font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  )
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[13.5px] text-muted-foreground">{children}</span>
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="kn-page-header mb-8 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="kn-page-title font-mono text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="kn-page-sub mt-1 text-[15px] text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex gap-2">{actions}</div> : null}
    </header>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <Card className="p-10 text-center text-[15px] text-muted-foreground">{children}</Card>
  )
}

/**
 * A row of numbers with what they mean underneath.
 *
 * The pattern every product page in the references uses to make a claim
 * concrete. Here the numbers have to come from the repositories rather than
 * from copy — a stat band asserting "8000+ brands" is marketing, but one
 * counting the claims actually in someone's namespaces is the product
 * demonstrating itself.
 */
export function Stats({ items }: { items: { value: string; label: string; hint?: string }[] }) {
  if (!items.length) return null
  return (
    <div className="grid gap-10 sm:grid-cols-3">
      {items.map((s) => (
        <div key={s.label}>
          <p className="font-display text-[clamp(2.8rem,5vw,4.6rem)] font-normal leading-[0.9] tracking-[-0.05em]">{s.value}</p>
          <div className="mt-4 border-t border-line pt-3">
            <p className="text-[12.5px] text-dim">{s.label}</p>
            {s.hint ? <p className="mt-1 text-[14px] leading-snug text-dim">{s.hint}</p> : null}
          </div>
        </div>
      ))}
    </div>
  )
}

/** A small label above a section, in the manner of `// About Us //`. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-line bg-surface px-2.5 py-1 text-[12.5px] font-medium tracking-wide text-dim">
      {children}
    </span>
  )
}

/**
 * A section heading: eyebrow, display title, and a line of prose.
 *
 * Used instead of a bare <h2> so that every section on every page shares one
 * rhythm — the references are consistent about this and it is most of why they
 * read as designed rather than assembled.
 */
export function SectionHeading({
  eyebrow,
  title,
  children,
  align = 'left',
}: {
  eyebrow?: string
  title: ReactNode
  children?: ReactNode
  align?: 'left' | 'center'
}) {
  return (
    <div className={`mb-6 ${align === 'center' ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl'}`}>
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h2 className={`font-display text-[clamp(1.75rem,3.6vw,2.4rem)] leading-[0.98] tracking-[-0.03em] ${eyebrow ? 'mt-3' : ''}`}>{title}</h2>
      {children ? <p className="mt-2 text-[15px] leading-relaxed text-dim">{children}</p> : null}
    </div>
  )
}

/**
 * A panel that sits above the page rather than in it.
 *
 * The floating-card treatment the references use for product chrome: a soft
 * tint, a generous radius and a shadow doing the lifting instead of a border.
 */
export function Panel({
  children,
  className = '',
  tone = 'plain',
}: {
  children: ReactNode
  className?: string
  tone?: 'plain' | 'soft' | 'accent'
}) {
  const tones = {
    plain: 'bg-surface border-line',
    soft: 'bg-raised/50 border-line/70',
    accent: 'bg-accent-soft border-accent/30',
  } as const
  return <div className={`rounded-3xl border ${tones[tone]} p-6 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_8px_24px_-12px_rgba(0,0,0,0.08)] ${className}`}>{children}</div>
}

/**
 * Why nothing is here, and what to do about it.
 *
 * Empty states were inconsistent across the app, and the most common question
 * the demo produces — "why was this not remembered?" — had no answer anywhere
 * in the interface. An empty state that explains itself is the cheapest place
 * to answer it.
 */
export function Nothing({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-6 py-10 text-center">
      <p className="text-[15px] font-medium">{title}</p>
      {children ? <p className="mx-auto mt-1.5 max-w-md text-[14.5px] leading-relaxed text-dim">{children}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}
