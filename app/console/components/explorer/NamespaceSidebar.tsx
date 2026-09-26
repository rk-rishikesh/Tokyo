'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { NavNode } from '@/lib/explorerTree'

const KEY = 'kn.explorer.collapsed'
const ENS = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.eth$/

/** The namespace a /k/… path is showing, if any. */
const current = (path: string) => (path.startsWith('/k/') ? decodeURIComponent(path.split('/')[2] ?? '') : null)

function matches(n: NavNode, q: string): boolean {
  return n.name.includes(q) || (n.title?.toLowerCase().includes(q) ?? false) || n.children.some((c) => matches(c, q))
}

/**
 * The explorer's left column: find, then the network as a tree. Selecting a
 * namespace opens it on the right; the tree stays put, like a project list.
 */
export function NamespaceSidebar({ nodes }: { nodes: NavNode[] }) {
  const pathname = usePathname()
  const router = useRouter()
  const active = current(pathname)
  const [q, setQ] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState(false) // the list on narrow screens
  const find = useRef<HTMLInputElement>(null)

  useEffect(() => {
    try { const raw = localStorage.getItem(KEY); if (raw) setCollapsed(new Set(JSON.parse(raw) as string[])) } catch { /* a remembered fold is a convenience */ }
  }, [])
  useEffect(() => { setOpen(false) }, [pathname])
  // "F" focuses find, as in the reference, unless the reader is already typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (e.key.toLowerCase() !== 'f' || e.metaKey || e.ctrlKey || e.altKey || t?.closest('input, textarea, [contenteditable]')) return
      e.preventDefault(); find.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const toggle = (name: string) => setCollapsed((prev) => {
    const next = new Set(prev)
    if (next.has(name)) next.delete(name); else next.add(name)
    try { localStorage.setItem(KEY, JSON.stringify([...next])) } catch { /* ignore */ }
    return next
  })

  const query = q.trim().toLowerCase()
  const shown = useMemo(() => (query ? nodes.filter((n) => matches(n, query)) : nodes), [nodes, query])
  const count = useMemo(() => { const c = (ns: NavNode[]): number => ns.reduce((n, x) => n + (x.readable ? 1 : 0) + c(x.children), 0); return c(nodes) }, [nodes])

  // Enter opens an exact match, or looks any other ENS name up on the network.
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!query) return
    const flat = (ns: NavNode[]): NavNode[] => ns.flatMap((n) => [n, ...flat(n.children)])
    const hit = flat(nodes).find((n) => n.readable && (n.name === query || n.name === `${query}.eth`))
      ?? (flat(shown).filter((n) => n.readable && matches(n, query)).length === 1 ? flat(shown).find((n) => n.readable && matches(n, query)) : undefined)
    if (hit) { router.push(`/k/${encodeURIComponent(hit.name)}`); setQ(''); return }
    const name = query.endsWith('.eth') ? query : `${query}.eth`
    if (ENS.test(name)) router.push(`/namespaces?name=${encodeURIComponent(name)}`)
  }

  const list = (
    <nav aria-label="Namespaces" className="flex flex-col gap-0.5 text-[14px]">
      <Link href="/namespaces" className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors ${pathname === '/namespaces' ? 'bg-raised font-medium text-ink' : 'text-ink/80 hover:bg-raised/70'}`}>
        <GridIcon /> Overview
      </Link>
      <p className="mb-1 mt-4 px-2.5 text-[11.5px] uppercase tracking-[0.1em] text-dim">Namespaces · {count}</p>
      {shown.length ? shown.map((n) => <Row key={n.name} n={n} depth={0} active={active} collapsed={query ? new Set() : collapsed} toggle={toggle} query={query} />)
        : <p className="px-2.5 py-2 text-[13px] text-dim">No namespace here matches. Press Enter to look <span className="font-mono">{query.endsWith('.eth') ? query : `${query}.eth`}</span> up on ENS.</p>}
    </nav>
  )

  return (
    <div className="flex h-full flex-col">
      <form onSubmit={submit} className="p-3" role="search">
        <label className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 focus-within:border-ink/40">
          <SearchIcon />
          <input ref={find} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find" aria-label="Find a namespace, or look up any ENS name" spellCheck={false} autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-dim" />
          <kbd className="rounded-md border border-line px-1.5 text-[11.5px] text-dim">F</kbd>
        </label>
      </form>
      {/* Wide screens: always there. Narrow ones: behind a toggle, above the page. */}
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mx-3 mb-2 flex items-center justify-between rounded-lg border border-line px-3 py-2 text-[14px] lg:hidden">
        <span className="font-mono">{active ?? 'All namespaces'}</span><Chevron open={open} />
      </button>
      <div className={`${open ? 'block' : 'hidden'} min-h-0 flex-1 overflow-y-auto px-3 pb-6 lg:block`}>{list}</div>
    </div>
  )
}

function Row({ n, depth, active, collapsed, toggle, query }: { n: NavNode; depth: number; active: string | null; collapsed: Set<string>; toggle: (name: string) => void; query: string }) {
  const isActive = active === n.name
  const folded = collapsed.has(n.name)
  const kids = query ? n.children.filter((c) => matches(c, query)) : n.children
  // Roots read in full; a child shows only its own label, since its parent is the row above.
  const own = depth === 0 ? n.name.replace(/\.eth$/, '') : n.name.split('.')[0]!
  const rest = depth === 0 ? n.name.slice(own.length) : ''
  const label = (
    <span className="flex min-w-0 items-center gap-2">
      {depth === 0 ? <Monogram name={n.name} /> : null}
      <span className="truncate font-mono text-[13.5px]"><span className={isActive ? 'font-semibold text-ink' : 'text-ink'}>{own}</span><span className="text-dim">{rest}</span></span>
    </span>
  )
  const meta = (
    <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[11.5px] tabular-nums text-dim">
      {n.open ? <span className="rounded-full bg-ink px-1.5 text-bg" title={`${n.open} to review`}>{n.open}</span> : null}
      {n.sealed ? <LockIcon /> : null}
      {n.version !== undefined ? <span className="font-mono">v{n.version}</span> : null}
    </span>
  )
  const rowClass = `group flex items-center gap-1 rounded-lg py-1.5 pr-2.5 transition-colors ${isActive ? 'bg-raised' : 'hover:bg-raised/70'}`
  return (
    <div>
      <div className={rowClass} style={{ paddingLeft: 4 + depth * 14 }}>
        {n.children.length ? (
          <button type="button" onClick={() => toggle(n.name)} aria-label={`${folded ? 'Expand' : 'Collapse'} ${n.name}`} aria-expanded={!folded} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-dim hover:bg-line/60 hover:text-ink">
            <Chevron open={!folded} />
          </button>
        ) : <span className="w-6 shrink-0" aria-hidden />}
        {n.readable ? (
          <Link href={`/k/${encodeURIComponent(n.name)}`} aria-current={isActive ? 'page' : undefined} title={n.title ?? n.name} className="flex min-w-0 flex-1 items-center gap-2">{label}{meta}</Link>
        ) : (
          <Link href={`/namespaces?name=${encodeURIComponent(n.name)}`} title={n.sealed ? 'Encrypted — this explorer holds no key for it' : 'Holds no claims of its own'} className="flex min-w-0 flex-1 items-center gap-2 opacity-70">{label}{meta}</Link>
        )}
      </div>
      {kids.length && !folded ? <div>{kids.map((c) => <Row key={c.name} n={c} depth={depth + 1} active={active} collapsed={collapsed} toggle={toggle} query={query} />)}</div> : null}
    </div>
  )
}

function Monogram({ name }: { name: string }) {
  const letters = name.replace(/\.eth$/, '').split(/[-.]/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')
  return <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-ink text-[10.5px] font-semibold text-bg" aria-hidden>{letters}</span>
}
function Chevron({ open }: { open: boolean }) {
  return <svg viewBox="0 0 16 16" className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
function LockIcon() {
  return <svg viewBox="0 0 16 16" className="h-3 w-3" aria-label="encrypted"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
}
function SearchIcon() {
  return <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-dim" aria-hidden><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
}
function GridIcon() {
  return <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0" aria-hidden><rect x="2" y="2" width="5" height="5" rx="1.2" fill="currentColor" /><rect x="9" y="2" width="5" height="5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.3" /><rect x="2" y="9" width="5" height="5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.3" /><rect x="9" y="9" width="5" height="5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>
}
