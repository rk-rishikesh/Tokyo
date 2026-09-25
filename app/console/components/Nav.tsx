'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { Arrow } from '@/components/Arrow'

/**
 * Two products, two navigations.
 *
 * One nav listing fourteen routes made this look like one sprawling thing.
 * There are two: a protocol anyone can build on, and a demo product built on
 * it. They have different audiences and almost no pages in common, so mixing
 * their links meant every visitor read past most of them.
 *
 * The protocol nav is for someone deciding whether to adopt it. The app nav is
 * for someone whose memory this is — reviews, sources and the explanation of
 * what was left out are all about *their* data, so they belong beside the agent
 * rather than beside the specification.
 */

/**
 * The product: four places, one idea each.
 *
 *   Agent    — the workspace: connect sources, watch it learn, ask
 *   Memory   — everything you know (list, graph, history)
 *   Publish  — what is waiting to reach your name, and the one button for it
 *   Access   — who can read it, you included, without this app
 *
 * This was nine tabs, most of them the same namespaces in a different layout.
 */
const APP = [
  { href: '/app', label: 'Agent', exact: true },
  { href: '/app/memory', label: 'Memory', also: ['/app/knowledge', '/app/graph', '/app/history'] },
  { href: '/app/publish', label: 'Publish', also: ['/reviews'] },
  { href: '/app/access', label: 'Access', also: ['/app/agents', '/app/portability', '/app/authorize'] },
]

/** The protocol: what someone building on it needs. */
const PROTOCOL = [
  { href: '/namespaces', label: 'Explore', also: ['/k/', '/me/'] },
  { href: '/for-agents', label: 'Agents' },
  { href: '/developers', label: 'Developers' },
  { href: '/protocol', label: 'Protocol' },
]
const PROTOCOL_MORE = [
  { href: '/use-cases', label: 'use cases' },
  { href: '/roles', label: 'roles' },
  { href: '/compare/memory', label: 'vs. memory apps' },
  { href: '/faq', label: 'FAQ' },
]

/** Routes that belong to the demo product rather than the protocol. */
const APP_ROUTES = ['/app', '/reviews', '/why']

export function Nav() {
  const pathname = usePathname()
  const inApp = APP_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`))

  const active = (href: string, opts: { exact?: boolean; also?: string[] } = {}) =>
    (opts.exact ? pathname === href : pathname.startsWith(href)) || (opts.also ?? []).some((a) => pathname.startsWith(a))

  if (!inApp) return <ProtocolNav active={active} />

  // The product's navigation: the same mark and type as the protocol's, with
  // the owner's pages instead of the protocol's, and one way back.
  return (
    <header className="sticky top-0 z-30 w-full border-b border-line bg-bg/95 backdrop-blur-xl">
      <div className="flex w-full items-center gap-6 px-5 py-3.5 sm:px-8 lg:px-10">
        <Link href="/" aria-label="knowledge.eth — home" className="shrink-0">
          <svg viewBox="0 0 40 40" className="h-8 w-8" aria-hidden>
            <rect x="18" y="0" width="22" height="20" rx="3.5" className="fill-[hsl(var(--ink))]" />
            <rect x="0" y="18" width="22" height="22" rx="3.5" className="fill-[hsl(var(--ink))]" />
          </svg>
        </Link>
        <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-[14px] tracking-[-0.01em] [scrollbar-width:none]">
          {APP.map((l) => {
            const on = active(l.href, { ...('exact' in l && l.exact ? { exact: true } : {}), ...('also' in l && l.also ? { also: l.also } : {}) })
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`shrink-0 rounded-full px-3 py-1.5 transition ${on ? 'bg-ink text-bg' : 'text-ink/60 hover:text-ink'}`}
              >
                {l.label}
              </Link>
            )
          })}
        </nav>
        {/* A page can put its own controls here (the workspace puts the agent's
            status); otherwise it holds the way back to the protocol. */}
        <div id="kn-nav-slot" className="kn-nav-slot ml-auto flex shrink-0 items-center">
          <Link href="/protocol" className="kn-nav-default hidden text-[14.5px] text-ink/60 transition hover:text-ink md:block">
            The protocol <Arrow />
          </Link>
        </div>
      </div>
    </header>
  )
}

/**
 * The protocol's navigation: the mark on the left, a few words on the right,
 * and two lines that open everything else. Full width, no border until the
 * page scrolls under it.
 */
function ProtocolNav({ active }: { active: (href: string, opts?: { exact?: boolean; also?: string[] }) => boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <header className="sticky top-0 z-30 w-full bg-bg/95 backdrop-blur-xl">
      <div className="flex w-full items-center gap-8 px-5 py-4 sm:px-8 lg:px-10">
        <Link href="/" aria-label="knowledge.eth — home" className="shrink-0">
          <svg viewBox="0 0 40 40" className="h-9 w-9" aria-hidden>
            <rect x="18" y="0" width="22" height="20" rx="3.5" className="fill-[hsl(var(--ink))]" />
            <rect x="0" y="18" width="22" height="22" rx="3.5" className="fill-[hsl(var(--ink))]" />
          </svg>
        </Link>
        <nav className="ml-auto hidden items-center gap-9 text-[15px] tracking-[-0.01em] md:flex">
          {PROTOCOL.map((l) => (
            <Link key={l.href} href={l.href} className={`transition-opacity ${active(l.href, { ...(l.also ? { also: l.also } : {}) }) ? 'opacity-100' : 'opacity-80 hover:opacity-100'}`}>
              {l.label}
            </Link>
          ))}
          <Link href="/app" className="rounded-full bg-ink px-4 py-2 text-[13.5px] text-bg transition hover:opacity-85">Your agent</Link>
        </nav>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          className="ml-auto flex h-10 w-14 flex-col items-end justify-center gap-[7px] md:ml-6"
        >
          <span className={`block h-[1.5px] w-12 bg-ink transition-transform ${open ? 'translate-y-[4.25px] rotate-[8deg]' : ''}`} />
          <span className={`block h-[1.5px] w-12 bg-ink transition-transform ${open ? '-translate-y-[4.25px] -rotate-[8deg]' : ''}`} />
        </button>
      </div>
      {open ? (
        <div className="w-full border-t border-line bg-bg px-5 pb-10 pt-8 sm:px-8 lg:px-10">
          <div className="grid gap-8 md:grid-cols-2">
            <nav className="flex flex-col gap-1">
              {[...PROTOCOL, { href: '/app', label: 'Your agent' }].map((l) => (
                <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="font-display text-[clamp(2rem,4vw,3.4rem)] leading-[1.02] tracking-[-0.045em] opacity-90 hover:opacity-100">
                  {l.label}.
                </Link>
              ))}
            </nav>
            <nav className="flex flex-col gap-3 md:pt-3">
              {PROTOCOL_MORE.map((l) => (
                <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="text-[17px] tracking-[-0.01em] text-dim hover:text-ink">
                  {l.label[0]!.toUpperCase() + l.label.slice(1)}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      ) : null}
    </header>
  )
}
