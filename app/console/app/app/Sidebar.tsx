'use client'

/**
 * The sources, as a tool palette.
 *
 * The reference puts what you can add down the left and what you have built in
 * the middle. That maps onto this product exactly: sources are the things you
 * add, and the pipeline they feed is the thing you end up with.
 *
 * Grouped by whether a source is connected, because that is the only question
 * being asked of this column — everything else about a source lives in its
 * consent dialog.
 */
import { Monogram } from '@/components/Monogram'
import { useEffect, useState } from 'react'
import type { WorkspaceDef } from '@knowledge01/connect/workspaces'
import { ConnectButton } from './Consent'

export type SidebarSource = {
  ws: WorkspaceDef
  connected: boolean
  needsAuth: boolean
  failing?: string
  claims: number
}

export function Sidebar({ sources, owner }: { sources: SidebarSource[]; owner: string }) {
  const [query, setQuery] = useState('')
  const [open, setOpenState] = useState(true)
  // Remembered per browser; storage can be unavailable, and the default is open.
  useEffect(() => {
    try { if (localStorage.getItem('sources-collapsed') === '1') setOpenState(false) } catch { /* no storage */ }
  }, [])
  const setOpen = (v: boolean) => {
    setOpenState(v)
    try { localStorage.setItem('sources-collapsed', v ? '0' : '1') } catch { /* no storage */ }
  }

  const q = query.trim().toLowerCase()
  const shown = q ? sources.filter((s) => `${s.ws.name} ${s.ws.summary}`.toLowerCase().includes(q)) : sources
  const connected = shown.filter((s) => s.connected)
  const available = shown.filter((s) => !s.connected)

  if (!open) {
    return (
      <aside className="flex h-full w-[60px] shrink-0 flex-col items-center gap-2 border-r border-line bg-surface py-4">
        <button
          onClick={() => setOpen(true)}
          className="mb-2 rounded-lg p-1.5 text-dim transition-colors hover:bg-raised hover:text-ink"
          title="Expand sources"
          aria-label="Expand sources"
          aria-expanded={false}
        >
          <Chevron dir="right" />
        </button>
        {sources.map((s) => (
          <button key={s.ws.id} onClick={() => setOpen(true)} title={`${s.ws.name} — ${s.connected ? 'connected' : 'not connected'}`} className="relative rounded-lg transition-opacity hover:opacity-80">
            <Monogram name={s.ws.name} size="sm" />
            {s.connected ? <span className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface ${s.failing ? 'bg-removed' : 'bg-accent'}`} aria-hidden /> : null}
          </button>
        ))}
      </aside>
    )
  }

  return (
    <aside className="flex h-full w-[300px] shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex items-center justify-between px-4 pb-3 pt-4">
        <h2 className="text-[14px] font-semibold">Sources</h2>
        <button
          onClick={() => setOpen(false)}
          className="rounded-lg p-1.5 text-dim transition-colors hover:bg-raised hover:text-ink"
          title="Collapse sources"
          aria-label="Collapse sources"
          aria-expanded
        >
          <Chevron dir="left" />
        </button>
      </div>

      <div className="px-4 pb-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          className="w-full rounded-xl border border-line bg-raised/50 px-3 py-2 text-[14.5px] outline-none focus:border-accent/50"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {connected.length ? (
          <Group label={`Connected · ${connected.length}`}>
            {connected.map((s) => <Tile key={s.ws.id} source={s} owner={owner} />)}
          </Group>
        ) : null}
        {available.length ? (
          <Group label="Available">
            {available.map((s) => <Tile key={s.ws.id} source={s} owner={owner} />)}
          </Group>
        ) : null}
        {!shown.length ? <p className="px-2 py-6 text-center text-[14px] text-dim">Nothing matches “{query}”.</p> : null}
      </div>
    </aside>
  )
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <p className="px-2 pb-2 text-[12px] uppercase tracking-[0.12em] text-dim">{label}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

/**
 * One source.
 *
 * A tile says three things and no more: what it is, whether it is working, and
 * how much it has contributed. A source whose token expired reads differently
 * from one nobody connected, which is the distinction that used to be invisible.
 */
function Tile({ source, owner }: { source: SidebarSource; owner: string }) {
  const { ws, connected, needsAuth, failing, claims } = source
  return (
    <div
      className={`group flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
        failing ? 'border-removed/40 bg-removed-bg/30' : connected ? 'border-accent/40 bg-accent-soft/40' : 'border-line bg-raised/40 hover:border-accent/30'
      }`}
    >
      <Monogram name={ws.name} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium" title={ws.name}>{ws.name}</p>
        <p className="text-[12px] text-dim">
          {failing ? 'needs reconnecting' : connected ? (claims ? `${claims} claim${claims === 1 ? '' : 's'}` : 'reading') : 'not connected'}
        </p>
      </div>
      <div className="shrink-0">
        <ConnectButton ws={ws} connected={connected} owner={owner} needsAuth={needsAuth} />
      </div>
    </div>
  )
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 16 16" className={`h-4 w-4 ${dir === 'right' ? 'rotate-180' : ''}`} aria-hidden>
      <path d="M10 3.5 5.5 8 10 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
