import type { AgentView } from '@k01/connect'
import type { Owned } from '../owned'

/**
 * Memory, drawn as a tree that reads left to right:
 *
 *   writer → your name → namespaces → what each one knows
 *
 * Columns are fixed and labelled, rows are allotted per namespace by how many
 * subjects it holds, and every wire runs from one card's right edge to the next
 * card's left edge — nothing crosses and nothing ends in the air. Who can read a
 * namespace is a tag on the namespace, because access is a property of it.
 */
const ROW = 46
const BLOCK_GAP = 26
const TOP = 70
const COL = {
  writer: { x: 40, w: 170 },
  name: { x: 290, w: 200 },
  ns: { x: 580, w: 280 },
  subject: { x: 950, w: 250 },
}
const W = COL.subject.x + COL.subject.w + 40

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** A wire from the right edge of one card to the left edge of the next. */
const wire = (x1: number, y1: number, x2: number, y2: number) => {
  const k = (x2 - x1) * 0.5
  return `M ${x1} ${y1} C ${x1 + k} ${y1}, ${x2 - k} ${y2}, ${x2} ${y2}`
}

export function GraphView({ owner, all, agents }: { owner: string; all: Owned[]; agents: AgentView[] }) {
  // Allot rows: each namespace gets a block as tall as its subject list.
  let y = TOP
  const blocks = all.map((o) => {
    const snap = Object.values(o.head?.snapshot ?? {})
    const counts = new Map<string, number>()
    for (const k of snap) {
      const s = k.subject ?? k.topic ?? 'notes'
      counts.set(s, (counts.get(s) ?? 0) + 1)
    }
    const subjects = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    const rows = Math.max(1, subjects.length)
    const top = y
    y += rows * ROW + BLOCK_GAP
    const readers = agents.filter((a) => a.namespaces.some((n) => n.namespace === o.access.namespace)).map((a) => a.agent)
    return {
      o,
      readers,
      cy: top + ((rows - 1) * ROW) / 2 + 17,
      subjects: subjects.map(([label, count], i) => ({ label, count, cy: top + i * ROW + 17 })),
    }
  })
  const H = Math.max(y + 20, 360)
  const nameY = blocks.length ? (blocks[0]!.cy + blocks[blocks.length - 1]!.cy) / 2 : H / 2

  return (
    <>
      {blocks.length ? (
        <div className="overflow-x-auto rounded-[28px] bg-canvas [background-image:radial-gradient(hsl(var(--ink)/0.09)_1px,transparent_1px)] [background-size:22px_22px]">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[900px]" role="img" aria-label={`${owner}: ${blocks.length} namespaces, ${agents.length} agents with access`}>
            <defs>
              <marker id="g-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M 1.5 1.5 L 8 5 L 1.5 8.5" fill="none" stroke="hsl(var(--ink) / 0.55)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
              </marker>
            </defs>

            {/* Column headings. */}
            {([['writer', 'Writes'], ['name', 'Your name'], ['ns', 'Namespaces'], ['subject', 'What they know']] as const).map(([k, label]) => (
              <text key={k} x={COL[k].x} y={32} className="fill-[hsl(var(--dim))] text-[13px]">{label}</text>
            ))}
            <line x1={COL.writer.x} y1={44} x2={W - 40} y2={44} className="stroke-[hsl(var(--line))]" />

            {/* Wires first, so cards sit on top of them. */}
            <path
              d={wire(COL.writer.x + COL.writer.w, nameY, COL.name.x - 6, nameY)}
              fill="none"
              className="kn-wire-flow stroke-[hsl(var(--ink)/0.45)]"
              strokeWidth={1.5}
              strokeDasharray="5 6"
              markerEnd="url(#g-arrow)"
            />
            {blocks.map((b) => (
              <g key={`w-${b.o.access.namespace}`}>
                <path d={wire(COL.name.x + COL.name.w, nameY, COL.ns.x, b.cy)} fill="none" className="stroke-[hsl(var(--ink)/0.35)]" strokeWidth={1.4} />
                {b.subjects.map((s) => (
                  <path key={s.label} d={wire(COL.ns.x + COL.ns.w, b.cy, COL.subject.x, s.cy)} fill="none" className="stroke-[hsl(var(--ink)/0.18)]" strokeWidth={1.2} />
                ))}
              </g>
            ))}

            {/* Writer. */}
            <g>
              <rect x={COL.writer.x} y={nameY - 24} width={COL.writer.w} height={48} rx={24} className="fill-[hsl(var(--surface))] stroke-[hsl(var(--line))]" />
              <text x={COL.writer.x + 20} y={nameY - 2} className="fill-[hsl(var(--ink))] text-[14px]">Agent A</text>
              <text x={COL.writer.x + 20} y={nameY + 13} className="fill-[hsl(var(--dim))] text-[11.5px]">this app · writes</text>
            </g>

            {/* Your name. */}
            <g>
              <rect x={COL.name.x} y={nameY - 30} width={COL.name.w} height={60} rx={20} className="fill-[hsl(var(--ink))]" />
              <text x={COL.name.x + COL.name.w / 2} y={nameY - 1} textAnchor="middle" className="fill-[hsl(var(--bg))] font-mono text-[13.5px]">{clip(owner, 22)}</text>
              <text x={COL.name.x + COL.name.w / 2} y={nameY + 15} textAnchor="middle" className="fill-[hsl(var(--bg)/0.55)] text-[11.5px]">owned on chain</text>
            </g>

            {/* Namespaces, with who may read each. */}
            {blocks.map((b) => {
              const a = b.o.access
              const state = a.encrypted ? (b.readers.length ? 'shared' : 'private') : 'public'
              const tag = clip(b.readers.join(', '), 18)
              const tagW = 20 + tag.length * 5.8
              return (
                <g key={`n-${a.namespace}`}>
                  <rect x={COL.ns.x} y={b.cy - 28} width={COL.ns.w} height={56} rx={16} className={`fill-[hsl(var(--surface))] ${state === 'shared' ? 'stroke-[hsl(var(--ink)/0.7)]' : 'stroke-[hsl(var(--line))]'}`} strokeWidth={state === 'shared' ? 1.4 : 1} />
                  <text x={COL.ns.x + 18} y={b.cy - 5} className="fill-[hsl(var(--ink))] font-mono text-[13px]">{clip(a.namespace, b.readers.length ? 22 : 32)}</text>
                  <text x={COL.ns.x + 18} y={b.cy + 13} className="fill-[hsl(var(--dim))] text-[11.5px]">
                    {state} · v{a.version} · {Object.keys(b.o.head?.snapshot ?? {}).length} claims
                  </text>
                  {b.readers.length ? (
                    <g>
                      <rect x={COL.ns.x + COL.ns.w - 14 - tagW} y={b.cy - 11} width={tagW} height={22} rx={11} className="fill-[hsl(var(--ink))]" />
                      <text x={COL.ns.x + COL.ns.w - 14 - tagW / 2} y={b.cy + 4} textAnchor="middle" className="fill-[hsl(var(--bg))] text-[11.5px]">{tag}</text>
                    </g>
                  ) : null}
                </g>
              )
            })}

            {/* What each namespace knows. */}
            {blocks.flatMap((b) => b.subjects.map((s) => (
              <g key={`s-${b.o.access.namespace}-${s.label}`}>
                <rect x={COL.subject.x} y={s.cy - 16} width={COL.subject.w} height={32} rx={16} className="fill-[hsl(var(--raised))]" />
                <text x={COL.subject.x + 16} y={s.cy + 4} className="fill-[hsl(var(--ink))] text-[13px]">{clip(s.label, 28)}</text>
                <text x={COL.subject.x + COL.subject.w - 16} y={s.cy + 4} textAnchor="end" className="fill-[hsl(var(--dim))] text-[12px]">{s.count}</text>
              </g>
            )))}
          </svg>
        </div>
      ) : (
        <p className="rounded-3xl border border-dashed border-line px-6 py-10 text-center text-[14px] text-dim">Nothing to draw yet.</p>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] text-dim">
        <span className="flex items-center gap-2"><span className="h-3 w-5 rounded-full border border-line bg-surface" />private — sealed only to you</span>
        <span className="flex items-center gap-2"><span className="h-3 w-5 rounded-full border border-ink/70 bg-surface" />shared — the dark tag names who reads it</span>
        <span>{agents.length ? `${agents.length} agent${agents.length === 1 ? '' : 's'} with access` : 'No agent has access yet — grant one from Access.'}</span>
      </div>
    </>
  )
}
