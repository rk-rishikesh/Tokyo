import type { ReactNode } from 'react'
import { Arrow } from '@/components/Arrow'

/**
 * The page opening: a small label, then a headline on the left against grey
 * prose on the right — the same grammar as every protocol page.
 */
export function Title({ eyebrow, children, sub }: { eyebrow?: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <header className="mb-12 pt-4">
      {eyebrow ? <p className="text-[14px] leading-tight text-ink">{eyebrow[0]!.toUpperCase() + eyebrow.slice(1)}.</p> : null}
      <div className="mt-5 grid gap-8 lg:grid-cols-2">
        <h1 className="font-display text-[clamp(2.4rem,5.4vw,5rem)] font-normal leading-[0.94] tracking-[-0.045em]">{children}</h1>
        {sub ? <p className="max-w-2xl self-end text-[15px] leading-relaxed text-dim">{sub}</p> : null}
      </div>
    </header>
  )
}

/** The three ways a namespace can be read, drawn rather than emoji'd. */
function LockIcon({ kind }: { kind: 'private' | 'shared' | 'public' }) {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {kind === 'public' ? (
        <><circle cx="8" cy="8" r="6" /><path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12" /></>
      ) : (
        <><rect x="3" y="7" width="10" height="7" rx="1.8" /><path d={kind === 'shared' ? 'M5.5 7V5a2.5 2.5 0 0 1 4.8-1' : 'M5.5 7V5a2.5 2.5 0 0 1 5 0v2'} />{kind === 'shared' ? <circle cx="8" cy="10.5" r="0.9" fill="currentColor" /> : null}</>
      )}
    </svg>
  )
}

/**
 * How a namespace can be read, in one glyph.
 *
 *   private — encrypted, and sealed to nobody but you
 *   shared  — encrypted, and sealed to agents you chose (set in ink)
 *   public  — plaintext, for anyone
 */
export function Lock({ encrypted, agents }: { encrypted: boolean; agents: number }) {
  const [kind, label] = !encrypted ? ['public', 'public'] as const : agents ? ['shared', `shared with ${agents} agent${agents === 1 ? '' : 's'}`] as const : ['private', 'private to you'] as const
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] ${kind === 'shared' ? 'bg-ink text-bg' : 'border border-line text-dim'}`} title={label}>
      <LockIcon kind={kind} />
      {label}
    </span>
  )
}

export const short = (h: string, n = 8) => (h.length > n * 2 + 1 ? `${h.slice(0, n + 2)}…${h.slice(-n)}` : h)

export const ago = (iso: string) => {
  if (!iso) return 'never'
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86_400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86_400)}d ago`
}

export function SignInFirst() {
  return (
    <div className="rounded-3xl border border-dashed border-line px-6 py-14 text-center">
      <p className="text-[15px] font-medium">Connect your wallet first</p>
      <p className="mx-auto mt-1.5 max-w-md text-[14.5px] text-dim">These pages are about memory under a name you own, so they need to know which name that is.</p>
      <a href="/app" className="mt-5 inline-flex items-center gap-3 rounded-full bg-ink px-6 py-3 text-[14px] text-bg">Go to the app <Arrow /></a>
    </div>
  )
}

/**
 * One section of an owner page: a hairline, a title on the left with a line of
 * explanation, the content on the right. Every owner page is made of these, so
 * the pages differ in what they say, not in how they are laid out.
 */
export function Block({ title, note, children, id, aside }: { title: string; note?: ReactNode; children: ReactNode; id?: string; aside?: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-line py-10">
      <div className="grid gap-6 lg:grid-cols-[18rem_1fr] lg:gap-12">
        <div>
          <h2 className="text-[clamp(1.25rem,1.8vw,1.6rem)] leading-tight tracking-[-0.03em]">{title}</h2>
          {note ? <p className="mt-2 max-w-[34ch] text-[14.5px] leading-relaxed text-dim">{note}</p> : null}
          {aside ? <div className="mt-4">{aside}</div> : null}
        </div>
        <div className="min-w-0">{children}</div>
      </div>
    </section>
  )
}

/** A segmented switch between views of one page, as plain links. */
export function Views({ current, views }: { current: string; views: { id: string; label: string; href: string }[] }) {
  return (
    <nav className="mb-8 inline-flex rounded-full border border-line p-1 text-[14.5px]">
      {views.map((v) => (
        <a key={v.id} href={v.href} className={`rounded-full px-4 py-1.5 transition ${v.id === current ? 'bg-ink text-bg' : 'text-ink/60 hover:text-ink'}`}>
          {v.label}
        </a>
      ))}
    </nav>
  )
}
