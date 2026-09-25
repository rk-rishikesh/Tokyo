'use client'

/**
 * The product loop, as a living diagram rather than an architecture chart:
 * sources → propose → review → commit → ENS V2 → IPFS → network → consumers → contribute ↺.
 * Wires animate in the direction knowledge flows. Hover a source or consumer to
 * see what it stands for. Mobile gets the same nodes stacked.
 */
import { useState } from 'react'

/**
 * The five kinds of source, each labelled with what actually reads today where
 * one does. Nothing here names an integration that does not exist.
 */
const SOURCES = [
  { id: 'human', label: 'People', glyph: '👤', names: ['experts', 'teammates'], blurb: 'Experts and teammates state what they know — into a review queue, not a chat log.' },
  { id: 'document', label: 'Documents', glyph: '📄', names: ['papers', 'manifests'], blurb: 'Papers, policies, regulatory approvals and project manifests: the places facts are already written down. Every claim cites its document by title and id.' },
  { id: 'api', label: 'APIs', glyph: '⚡', names: [], blurb: 'Systems of record — trial registries, block explorers, your own services. Any endpoint you own can contribute through the SDK.' },
  { id: 'agent', label: 'Agents', glyph: '🤖', names: ['Claude Code', 'Cursor'], blurb: 'Coding agents propose conventions they learn while working, through MCP. Live today.' },
  { id: 'application', label: 'Applications', glyph: '🧩', names: ['browser', 'editor', 'shell'], blurb: 'Products whose knowledge is trapped inside them. Your browser, editor and shell read locally today.' },
]
const STAGES = [
  { id: 'propose', label: 'Propose', blurb: 'A branch, a commit, a proposal. Nothing overwrites.' },
  { id: 'review', label: 'Review', blurb: 'Automated findings — duplicates, contradictions, missing sources — then a person decides.' },
  { id: 'commit', label: 'Commit', blurb: 'A content-hashed version: vN → vN+1, reviewers stamped on every claim.' },
]
const CONSUMERS = [
  { id: 'agent-c', label: 'Agent', glyph: '🤖', blurb: 'knowledge_search over MCP: claims with sources, reviewers, version.' },
  { id: 'app-c', label: 'App', glyph: '🧩', blurb: 'Namespace.for(name).search(…) — the same objects, in your product.' },
  { id: 'human-c', label: 'Human', glyph: '👤', blurb: 'This explorer: outline, history, reviews, provenance.' },
]

export function Loop() {
  const [hover, setHover] = useState<string | null>(null)
  const blurb = [...SOURCES, ...STAGES, ...CONSUMERS].find((n) => n.id === hover)?.blurb
  const node = (n: { id: string; label: string; glyph?: string; names?: string[] }, cls: string) => (
    <button key={n.id} type="button" onMouseEnter={() => setHover(n.id)} onFocus={() => setHover(n.id)} onMouseLeave={() => setHover(null)} onBlur={() => setHover(null)}
      className={`flex w-full flex-col gap-0.5 rounded-xl border bg-surface px-3 py-2 text-left text-[14.5px] font-medium shadow-sm transition-colors ${hover === n.id ? 'border-accent' : 'border-line hover:border-dim/40'} ${cls}`}>
      <span className="flex items-center gap-2">{n.glyph ? <span aria-hidden>{n.glyph}</span> : null}{n.label}</span>
      {n.names?.length ? <span className="pl-6 text-[12.5px] font-normal text-dim">{n.names.join(' · ')}</span> : null}
    </button>
  )
  return (
    <div className="canvas rounded-2xl border border-line p-5 sm:p-8">
      <div className="grid gap-6 lg:grid-cols-[1fr_auto_1fr_auto_1fr] lg:items-center">
        {/* Sources */}
        <div>
          <p className="mb-2 text-[12.5px] font-medium uppercase tracking-wider text-dim">Data sources</p>
          <div className="grid gap-2">{SOURCES.map((s) => node(s, ''))}</div>
        </div>
        <Wire />
        {/* Network */}
        <div className="space-y-3">
          <p className="mb-2 text-[12.5px] font-medium uppercase tracking-wider text-dim">Knowledge network</p>
          <div className="grid gap-2">{STAGES.map((s) => node(s, 'justify-center'))}</div>
          <div className="mx-auto h-4 w-px bg-line" />
          <div className="pulse rounded-xl border border-accent/50 bg-accent-soft p-3 text-center">
            <p className="font-mono text-[15px] font-semibold">cancer-research.eth · v42</p>
            <p className="mt-1 text-[12.5px] text-dim">ENS V2 — identity, namespace, ownership, access</p>
            <p className="mt-0.5 text-[12.5px] text-dim">IPFS — immutable, content-addressed versions</p>
          </div>
        </div>
        <Wire />
        {/* Consumers */}
        <div>
          <p className="mb-2 text-[12.5px] font-medium uppercase tracking-wider text-dim">Consumers</p>
          <div className="grid gap-2">{CONSUMERS.map((c) => node(c, ''))}</div>
          <div className="mt-3 rounded-xl border border-dashed border-line px-3 py-2 text-center text-[13.5px] text-dim">consume → contribute ↺</div>
        </div>
      </div>
      <p className="mt-5 min-h-[2.5rem] text-center text-[14.5px] text-dim">{blurb ?? 'Knowledge from anywhere becomes a proposal, gets reviewed, becomes a version under a name someone owns — and any agent can read it. Hover a node.'}</p>
    </div>
  )
}

function Wire() {
  return (
    <svg className="mx-auto hidden h-24 w-12 lg:block" viewBox="0 0 48 96" aria-hidden>
      <path d="M4 48 H44" className="flow stroke-accent" strokeWidth="2" fill="none" />
      <path d="M36 40 L44 48 L36 56" className="stroke-accent" strokeWidth="2" fill="none" />
    </svg>
  )
}
