'use client'

/**
 * The six flows, drawn as a canvas rather than a list.
 *
 * The layout encodes **real dependencies**, not decoration. Reading a collection
 * needs both a published collection and a live subscription, so that node is fed by
 * two others — which is why the canvas branches instead of running straight.
 * Lapsing hangs off subscribing, because that is the only thing it follows from.
 *
 * Selecting a node highlights it and the wires feeding it, and opens its steps
 * below. Only one node's detail is shown at a time: six five-point lists side by
 * side is the list we are replacing.
 */
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { FLOWS, type Flow, type Mode } from '@/content/copy'
import { Icons } from './icons'

type Box = { x: number; y: number; w: number; h: number }

/**
 * A wire between two measured cards, in pixels.
 *
 * Wires used to be placed by grid percentages while the cards sized to their
 * text, so the ends floated in space beside the cards they meant. Now every
 * end sits on a card's edge: forward edges leave the right side and enter the
 * left with horizontal tangents; an edge that steps back a column (merge →
 * publish) leaves the bottom and enters the top with vertical ones.
 */
function wirePath(a: Box, b: Box): string {
  const forward = b.x >= a.x + a.w - 1
  if (forward) {
    const x1 = a.x + a.w, y1 = a.y + a.h / 2
    const x2 = b.x - 7, y2 = b.y + b.h / 2
    const k = Math.max(28, (x2 - x1) * 0.55)
    return `M ${x1} ${y1} C ${x1 + k} ${y1}, ${x2 - k} ${y2}, ${x2} ${y2}`
  }
  const down = b.y > a.y
  const x1 = a.x + a.w / 2, y1 = down ? a.y + a.h : a.y
  const x2 = b.x + b.w / 2, y2 = down ? b.y - 7 : b.y + b.h + 7
  const k = Math.max(28, Math.abs(y2 - y1) * 0.5)
  return `M ${x1} ${y1} C ${x1} ${y1 + (down ? k : -k)}, ${x2} ${y2 - (down ? k : -k)}, ${x2} ${y2}`
}

function Node({
  flow,
  mode,
  active,
  onSelect,
}: {
  flow: Flow
  mode: Mode
  active: boolean
  onSelect: () => void
}) {
  const reading = flow[mode]
  return (
    <button
      onClick={onSelect}
      aria-pressed={active}
      className={`relative w-full rounded-[20px] border bg-surface px-5 py-4 text-left shadow-[0_1px_2px_rgba(0,0,0,0.03),0_12px_30px_-20px_rgba(0,0,0,0.25)] transition-colors ${
        active ? 'border-active-ring' : 'border-line hover:border-dim/40'
      }`}
    >
      {/* The badge overlaps the corner, so the card reads as a node on a
          surface rather than a row in a table. */}
      <span
        className={`absolute -left-2.5 -top-2.5 flex h-6 w-6 items-center justify-center rounded-full text-[12.5px] font-semibold transition-colors ${
          active ? 'bg-active-badge text-white' : 'bg-raised text-dim ring-1 ring-line'
        }`}
      >
        {flow.n}
      </span>

      <div className="flex items-center gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-chip text-ink/70">
          {Icons[flow.icon]}
        </span>
        <span key={`${flow.id}-${mode}-l`} className="relabel text-[15px] font-semibold">
          {reading.label}
        </span>
      </div>
      <p
        key={`${flow.id}-${mode}-d`}
        className="relabel mt-1.5 text-[13.5px] leading-snug text-dim"
      >
        {reading.detail}
      </p>
    </button>
  )
}

export function FlowCanvas({ mode }: { mode: Mode }) {
  const [activeId, setActiveId] = useState(FLOWS[0]!.id)
  const active = FLOWS.find((f) => f.id === activeId)!
  const byId = new Map(FLOWS.map((f) => [f.id, f]))

  const wires = FLOWS.flatMap((f) =>
    f.after.map((dep) => ({ from: byId.get(dep)!, to: f, key: `${dep}->${f.id}` })),
  )

  const stage = useRef<HTMLDivElement>(null)
  const cards = useRef(new Map<string, HTMLElement>())
  const [boxes, setBoxes] = useState<Record<string, Box>>({})

  const measure = useCallback(() => {
    const root = stage.current
    if (!root) return
    const o = root.getBoundingClientRect()
    const next: Record<string, Box> = {}
    for (const [id, el] of cards.current) {
      const r = el.getBoundingClientRect()
      next[id] = { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height }
    }
    setBoxes(next)
  }, [])

  // Re-measure whenever anything could move a card: resize, and the copy
  // changing length when the reading mode flips.
  useLayoutEffect(() => {
    measure()
    const ro = new ResizeObserver(measure)
    if (stage.current) ro.observe(stage.current)
    for (const el of cards.current.values()) ro.observe(el)
    return () => ro.disconnect()
  }, [measure, mode])

  return (
    <div>
      {/* Canvas — desktop only. The wires carry the meaning, and at phone width
          they would cross the cards rather than connect them. */}
      <div className="canvas relative hidden rounded-[28px] border border-line p-8 md:block">
        <div ref={stage} className="relative w-full">
          <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
            <defs>
              <marker id="kn-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 1 1.5 L 8 5 L 1 8.5" fill="none" stroke="hsl(var(--wire))" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </marker>
              <marker id="kn-arrow-on" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 1 1.5 L 8 5 L 1 8.5" fill="none" stroke="hsl(var(--active-badge))" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </marker>
            </defs>
            {wires.map((w) => {
              const a = boxes[w.from.id]
              const b = boxes[w.to.id]
              if (!a || !b) return null
              // Either direction: what flows out of the selected step as well
              // as what feeds it.
              const on = w.to.id === active.id || w.from.id === active.id
              return (
                <path
                  key={w.key}
                  d={wirePath(a, b)}
                  fill="none"
                  stroke={on ? 'hsl(var(--active-badge))' : 'hsl(var(--wire))'}
                  strokeWidth={on ? 1.8 : 1.3}
                  strokeDasharray={on ? '6 6' : '4 6'}
                  strokeLinecap="round"
                  markerEnd={on ? 'url(#kn-arrow-on)' : 'url(#kn-arrow)'}
                  className={on ? 'kn-wire-flow' : ''}
                  style={{ transition: 'stroke 180ms ease' }}
                />
              )
            })}
          </svg>

          <div className="relative grid grid-cols-4 grid-rows-[auto_auto_auto] gap-x-16 gap-y-14">
            {FLOWS.map((flow) => (
              <div
                key={flow.id}
                className="flex items-center"
                style={{ gridColumn: flow.at[0], gridRow: flow.at[1] }}
              >
                <div ref={(el) => { if (el) cards.current.set(flow.id, el); else cards.current.delete(flow.id) }} className="w-full">
                  <Node
                    flow={flow}
                    mode={mode}
                    active={flow.id === active.id}
                    onSelect={() => setActiveId(flow.id)}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Narrow screens: the same nodes, stacked, still selectable. */}
      <div className="canvas grid gap-3 rounded-2xl border border-line p-4 md:hidden">
        {FLOWS.map((flow) => (
          <Node
            key={flow.id}
            flow={flow}
            mode={mode}
            active={flow.id === active.id}
            onSelect={() => setActiveId(flow.id)}
          />
        ))}
      </div>

      {/* Detail for the selected node. */}
      <div className="mt-4 rounded-2xl border border-line bg-surface p-5">
        <div className="mb-3 flex items-center gap-2.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-active-badge text-[12.5px] font-semibold text-white">
            {active.n}
          </span>
          <h3 key={`h-${active.id}-${mode}`} className="relabel text-base font-semibold">
            {active[mode].label}
          </h3>
        </div>
        <ol key={`s-${active.id}-${mode}`} className="relabel space-y-2">
          {active[mode].steps.map((step, i) => (
            <li key={i} className="flex gap-3 text-[14.5px] leading-relaxed">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-wire" aria-hidden />
              <span className="text-ink/85">{step}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
