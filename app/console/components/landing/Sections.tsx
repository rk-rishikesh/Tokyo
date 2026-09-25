import Link from 'next/link'
import { Arrow } from '@/components/Arrow'

/**
 * The pieces the landing page is made of.
 *
 * The reference builds its argument in bands: a hero over a soft wash, a row of
 * names, one large statement that reads like a sentence rather than a headline,
 * a panel showing the product, cards for each audience, a dark band, questions,
 * and a closing line over a wordmark.
 *
 * What differs is what fills them. A logo row of companies we do not work with
 * would be the one thing this product cannot do — the argument is provenance,
 * and a page that fakes its own would be arguing against itself.
 */

/** A soft wash behind the hero. Decorative, and hidden from assistive tech. */
export function Aurora() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden>
      <div className="kn-aurora absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,hsl(var(--accent)/0.16),transparent)] blur-2xl" />
      <div
        className="kn-aurora absolute -top-24 right-[12%] h-[380px] w-[520px] rounded-full bg-[radial-gradient(closest-side,hsl(258_70%_62%/0.14),transparent)] blur-2xl"
        style={{ animationDelay: '3s' }}
      />
      <div
        className="kn-aurora absolute -top-10 left-[8%] h-[360px] w-[480px] rounded-full bg-[radial-gradient(closest-side,hsl(48_95%_60%/0.14),transparent)] blur-2xl"
        style={{ animationDelay: '6s' }}
      />
    </div>
  )
}

/**
 * A heading in the hero's voice.
 *
 * The hero sets the page's typographic register — oversized, leading below one,
 * negative tracking, lowercase — and the sections were answering in a different
 * one: fixed 30px, default leading, sentence case. Two voices on one page reads
 * as two pages.
 *
 * Three sizes, all built from the same clamp so they scale together and none of
 * them has a typed pixel value to drift.
 */
export function Display({
  children,
  size = 'md',
  className = '',
}: {
  children: React.ReactNode
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const scale = {
    sm: 'text-[clamp(1.6rem,3.2vw,2.4rem)]',
    md: 'text-[clamp(2.1rem,5vw,3.6rem)]',
    lg: 'text-[clamp(2.8rem,7vw,5.5rem)]',
  }[size]
  return (
    <h2 className={`font-display font-normal leading-[0.94] tracking-[-0.045em] ${scale} ${className}`}>
      {children}
    </h2>
  )
}

/** A line of small type above a heading. */
export function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[14px] leading-tight tracking-[-0.01em] text-ink">
      {children}
    </p>
  )
}

/**
 * A statement set large, with the words that carry it in ink and the rest dim.
 *
 * The reference uses this for its central claim. It works because the eye reads
 * the emphasised words first and they form a shorter sentence on their own.
 */
export function Statement({ parts }: { parts: { text: string; lead?: boolean }[] }) {
  return (
    <p className="font-display text-[clamp(1.5rem,3vw,2.3rem)] leading-[1.35] tracking-[-0.02em]">
      {parts.map((p, i) => (
        <span key={i} className={p.lead ? 'text-ink' : 'text-dim'}>
          {p.text}
        </span>
      ))}
    </p>
  )
}

export function Band({
  children,
  tone = 'plain',
  className = '',
}: {
  children: React.ReactNode
  tone?: 'plain' | 'dark' | 'soft'
  className?: string
}) {
  const tones = {
    plain: '',
    soft: 'bg-raised/40',
    dark: 'bg-ink text-bg',
  } as const
  return (
    <section className={`w-full ${tones[tone]} ${className}`}>
      <div className="w-full px-5 py-20 sm:px-8 sm:py-28 lg:px-10">{children}</div>
    </section>
  )
}

/** A card describing who this is for and what they get. */
export function AudienceCard({
  eyebrow,
  title,
  body,
  stats,
}: {
  eyebrow: string
  title: string
  body: string
  stats: { value: string; label: string }[]
}) {
  return (
    <div className="rounded-3xl border border-line bg-raised/40 p-6">
      <div className="flex flex-wrap gap-2">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl border border-line bg-surface px-4 py-3">
            <p className="font-display text-[clamp(1.3rem,2vw,1.6rem)] leading-none tracking-[-0.02em]">{s.value}</p>
            <p className="mt-1 text-[12.5px] text-dim">{s.label}</p>
          </div>
        ))}
      </div>
      <p className="mt-5 text-[12.5px] uppercase tracking-[0.12em] text-dim">{eyebrow}</p>
      <h3 className="mt-1 font-display text-[clamp(1.4rem,2.4vw,1.8rem)] leading-[1.05] tracking-[-0.02em]">{title}</h3>
      <p className="mt-2 text-[13.5px] leading-relaxed text-dim">{body}</p>
    </div>
  )
}

/** One question, open by default when it is the one people actually ask. */
export function Question({ q, children, open = false }: { q: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group border-b border-line py-6 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-[clamp(1.15rem,1.8vw,1.6rem)] leading-tight tracking-[-0.03em]">
        {q}
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-raised text-[20px] font-light text-dim transition-transform group-open:rotate-45" aria-hidden>+</span>
      </summary>
      <div className="mt-3 max-w-2xl text-[14px] leading-relaxed text-dim">{children}</div>
    </details>
  )
}

export function CallToAction({ title, body }: { title: React.ReactNode; body: string }) {
  return (
    <div className="grid gap-10 lg:grid-cols-2">
      <h2 className="font-display text-[clamp(2.6rem,6vw,5.6rem)] font-normal leading-[0.94] tracking-[-0.045em]">{title}</h2>
      <div>
        <p className="font-display text-[clamp(1.35rem,2.35vw,2.2rem)] leading-[1.12] tracking-[-0.035em] text-dim">{body}</p>
        <div className="mt-9 flex flex-wrap gap-3">
          <Link href="/app" className="group inline-flex items-center gap-3 rounded-full bg-ink px-6 py-3.5 text-[15px] text-bg transition hover:opacity-85">
            Build your knowledge <Arrow />
          </Link>
          <Link href="/developers" className="group inline-flex items-center gap-3 rounded-full border border-line px-6 py-3.5 text-[15px] transition hover:bg-raised">
            Build on it <Arrow />
          </Link>
        </div>
      </div>
    </div>
  )
}

/** The dark footer, closing on the wordmark. */
export function Footer() {
  const cols: { head: string; links: { href: string; label: string }[] }[] = [
    {
      head: 'The protocol',
      links: [
        { href: '/protocol', label: 'How it works' },
        { href: '/namespaces', label: 'Explore namespaces' },
        { href: '/roles', label: 'Roles' },
        { href: '/for-agents', label: 'For agents' },
      ],
    },
    {
      head: 'Build',
      links: [
        { href: '/developers', label: 'Developers' },
        { href: '/use-cases', label: 'Use cases' },
        { href: '/compare/memory', label: 'vs. memory apps' },
        { href: '/faq', label: 'FAQ' },
      ],
    },
    {
      head: 'Your memory',
      links: [
        { href: '/demo', label: 'Demo' },
        { href: '/app/memory', label: 'Memory' },
        { href: '/app/publish', label: 'Publish' },
        { href: '/app/access', label: 'Access' },
      ],
    },
  ]

  return (
    <footer className="w-full bg-ink text-bg">
      <div className="w-full px-5 pb-10 pt-20 sm:px-8 lg:px-10">
        <div className="grid gap-12 border-t border-bg/15 pt-10 sm:grid-cols-2 lg:grid-cols-4">
          <p className="text-[14px] leading-tight text-bg/60">Knowledge Network.<br />Memory your agents share.</p>
          {cols.map((c) => (
            <div key={c.head}>
              <p className="text-[14px] text-bg/50">{c.head}</p>
              <ul className="mt-4 space-y-2.5">
                {c.links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="text-[15px] tracking-[-0.01em] text-bg/90 transition-opacity hover:opacity-60">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-24 flex items-end justify-between gap-6 overflow-hidden">
          <p className="select-none font-display font-normal leading-[0.78] tracking-[-0.06em]" style={{ fontSize: 'clamp(4.5rem, 21vw, 24rem)' }}>
            K.01
          </p>
          <svg viewBox="0 0 40 40" className="mb-[1.2vw] h-[clamp(3.5rem,16vw,17rem)] w-[clamp(3.5rem,16vw,17rem)] shrink-0" aria-hidden>
            <rect x="18" y="0" width="22" height="20" rx="3.5" className="fill-[hsl(var(--bg))]" />
            <rect x="0" y="18" width="22" height="22" rx="3.5" className="fill-[hsl(var(--bg))]" />
          </svg>
        </div>
        <div className="mt-8 flex flex-wrap justify-between gap-3 border-t border-bg/15 pt-5 text-[13px] text-bg/50">
          <p>Your agents change. Your knowledge doesn&rsquo;t.</p>
          <p>Every claim names where it came from.</p>
        </div>
      </div>
    </footer>
  )
}
