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
import { useState } from 'react'
import type { WorkspaceDef } from '@k01/connect/workspaces'
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
  const [open, setOpen] = useState(true)

  const q = query.trim().toLowerCase()
  const shown = q ? sources.filter((s) => `${s.ws.name} ${s.ws.summary}`.toLowerCase().includes(q)) : sources
  const connected = shown.filter((s) => s.connected)
  const available = shown.filter((s) => !s.connected)

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="absolute left-4 top-4 z-20 rounded-xl border border-line bg-surface px-3 py-2 text-[13.5px] shadow-sm"
        title="Show sources"
      >
        ☰ Sources
      </button>
    )
  }

  return (
    <aside className="flex h-full w-[300px] shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex items-center justify-between px-4 pb-3 pt-4">
        <h2 className="text-[14px] font-semibold">Sources</h2>
        <button
          onClick={() => setOpen(false)}
          className="rounded-lg px-2 py-1 text-[13.5px] text-dim transition-colors hover:bg-raised"
          title="Hide"
        >
          ◧
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
      <div className="grid grid-cols-2 gap-2">{children}</div>
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
      className={`group relative rounded-2xl border p-3 transition-colors ${
        failing ? 'border-removed/40 bg-removed-bg/30' : connected ? 'border-accent/40 bg-accent-soft/40' : 'border-line bg-raised/40 hover:border-accent/30'
      }`}
    >
      <Monogram name={ws.name} size="sm" />
      <p className="mt-2 truncate text-[14px] font-medium" title={ws.name}>{ws.name}</p>
      <p className="mt-0.5 text-[12px] text-dim">
        {failing ? 'needs reconnecting' : connected ? (claims ? `${claims} claim${claims === 1 ? '' : 's'}` : 'reading') : 'not connected'}
      </p>
      <div className="mt-2">
        <ConnectButton ws={ws} connected={connected} owner={owner} needsAuth={needsAuth} />
      </div>
    </div>
  )
}
