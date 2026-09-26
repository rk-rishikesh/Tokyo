'use client'

/**
 * A node graph that runs: numbered cards on a dotted canvas, dashed wires
 * between them, a solid path into the last one, and packets travelling along
 * the wires in the order work actually happens.
 *
 * Rendered with Remotion's Player — a composition played in the page, not a
 * video file — so it scales with its container, follows the page's theme
 * through CSS variables, and loops without a download.
 */
import { Player } from '@remotion/player'
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import type { ReactNode } from 'react'

export type GraphNode = { id: string; n: number; title: string; sub: string; x: number; y: number; icon: IconName; final?: boolean; href?: string; tag?: string; w?: number }
export type GraphEdge = { from: string; to: string; solid?: boolean; at: number }

const W = 1760
const H = 760
const CARD_W = 340
const CARD_H = 112
/** A card can be wider than the rest when its title and tag need the room. */
const cw = (n: GraphNode) => n.w ?? CARD_W
const FPS = 30
const LOOP = 300

const ink = (a = 1) => `hsl(var(--ink) / ${a})`
const bg = (a = 1) => `hsl(var(--bg) / ${a})`

// ---------------------------------------------------------------------------

export type IconName = 'doc' | 'people' | 'plug' | 'pen' | 'calc' | 'flag' | 'key' | 'name' | 'agent' | 'eye' | 'lock'

function Icon({ name }: { name: IconName }) {
  const p: Record<IconName, ReactNode> = {
    doc: <><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4M10 12h5M10 16h5" /></>,
    people: <><circle cx="9" cy="8" r="3" /><path d="M3.5 19c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5" /><circle cx="17" cy="9" r="2.4" /><path d="M16 14.6c2 .2 3.6 1.5 4.3 4.4" /></>,
    plug: <><path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0z" /><path d="M12 17v4" /></>,
    pen: <><path d="M4 20l4-1 11-11-3-3L5 16z" /><path d="M14 6l3 3" /></>,
    calc: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 7h8M8 12h1M12 12h1M16 12h0M8 16h1M12 16h1M16 16h0" /></>,
    flag: <><path d="M6 21V4M6 4h11l-2 4 2 4H6" /></>,
    key: <><circle cx="8" cy="14" r="4" /><path d="M11 11l8-8M16 6l2 2M14 8l2 2" /></>,
    name: <><rect x="3" y="6" width="18" height="12" rx="3" /><path d="M7 12h10" /></>,
    agent: <><rect x="5" y="7" width="14" height="11" rx="3" /><path d="M12 3v4M9 12h0M15 12h0M9 15h6" /></>,
    eye: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" /><circle cx="12" cy="12" r="2.6" /></>,
    lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  }
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke={ink(0.85)} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      {p[name]}
    </svg>
  )
}

// ---------------------------------------------------------------------------

type Pt = { x: number; y: number }

function anchors(a: GraphNode, b: GraphNode, CARD_H: number): [Pt, Pt, Pt, Pt] {
  const from = { x: a.x + cw(a) / 2, y: a.y }
  const to = { x: b.x - cw(b) / 2, y: b.y }
  // Leave from the card's corner side when the target is above or below, so
  // wires fan out of a card the way they do in the reference.
  if (Math.abs(a.y - b.y) > 60) {
    from.x = a.x + cw(a) * 0.3
    from.y = a.y + (b.y < a.y ? -CARD_H / 2 : CARD_H / 2)
    to.x = b.x - cw(b) * 0.3
    to.y = b.y + (b.y < a.y ? CARD_H / 2 : -CARD_H / 2)
    const dx = (to.x - from.x) * 0.45
    return [from, { x: from.x + dx, y: from.y + (to.y - from.y) * 0.1 }, { x: to.x - dx, y: to.y - (to.y - from.y) * 0.1 }, to]
  }
  const dx = (to.x - from.x) * 0.5
  return [from, { x: from.x + dx, y: from.y }, { x: to.x - dx, y: to.y }, to]
}

const bezier = ([p0, p1, p2, p3]: [Pt, Pt, Pt, Pt], t: number): Pt => {
  const u = 1 - t
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  }
}

function Scene({ nodes, edges, cardH = CARD_H }: { nodes: GraphNode[]; edges: GraphEdge[]; cardH?: number }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const byId = new Map(nodes.map((n) => [n.id, n]))

  return (
    <AbsoluteFill style={{ backgroundColor: 'hsl(var(--canvas))', backgroundImage: `radial-gradient(${ink(0.13)} 1.1px, transparent 1.1px)`, backgroundSize: '22px 22px' }}>
      <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }}>
        {edges.map((e, i) => {
          const a = byId.get(e.from)!
          const b = byId.get(e.to)!
          const pts = anchors(a, b, cardH)
          const d = `M ${pts[0].x} ${pts[0].y} C ${pts[1].x} ${pts[1].y}, ${pts[2].x} ${pts[2].y}, ${pts[3].x} ${pts[3].y}`
          // Wires are always drawn; what moves is the packet, and the dash.
          const reveal = 1
          // One packet per edge, leaving when its source has lit up.
          const t = interpolate((frame - e.at + LOOP) % LOOP, [0, 42], [0, 1], { extrapolateRight: 'clamp' })
          const packet = bezier(pts, t)
          const visible = t > 0 && t < 1
          return (
            <g key={i} opacity={reveal}>
              <path d={d} fill="none" stroke={e.solid ? ink(0.9) : ink(0.28)} strokeWidth={e.solid ? 3 : 2} strokeDasharray={e.solid ? undefined : '7 8'} strokeDashoffset={e.solid ? 0 : -frame * 0.6} />
              {visible ? <circle cx={packet.x} cy={packet.y} r={e.solid ? 6 : 4.5} fill={ink(0.9)} /> : null}
            </g>
          )
        })}
      </svg>

      {nodes.map((n, i) => {
        // A gentle lift as each step takes its turn — never an entrance, which
        // would replay on every loop.
        const turn = (frame % LOOP) - (i * LOOP) / nodes.length
        const lift = spring({ frame: turn, fps, config: { damping: 14, mass: 0.6 } }) - spring({ frame: turn - LOOP / nodes.length, fps, config: { damping: 14, mass: 0.6 } })
        const enter = 1
        const lit = nodes.findIndex((x) => x.id === n.id)
        const glow = n.final ? interpolate(Math.sin(frame / 9), [-1, 1], [0.25, 0.6]) : 0
        const active = Math.floor((frame % LOOP) / (LOOP / nodes.length)) === lit
        return (
          <div
            key={n.id}
            style={{
              position: 'absolute', left: n.x - cw(n) / 2, top: n.y - cardH / 2, width: cw(n), height: cardH,
              transform: `translateY(${-lift * 6}px)`, opacity: enter,
              background: bg(1), borderRadius: 26,
              border: n.final ? `2.5px solid ${ink(0.9)}` : `1.5px solid ${ink(active ? 0.35 : 0.12)}`,
              boxShadow: n.final ? `0 22px 50px -18px ${ink(glow)}` : `0 1px 2px ${ink(0.04)}, 0 14px 34px -22px ${ink(0.25)}`,
              padding: '22px 26px', display: 'flex', flexDirection: 'column', justifyContent: 'center',
              fontFamily: 'var(--font-grotesk), var(--font-sans), sans-serif',
            }}
          >
            <div style={{ position: 'absolute', left: -18, top: -18, width: 40, height: 40, borderRadius: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, fontWeight: 500, background: n.final ? ink(0.9) : 'hsl(var(--raised))', color: n.final ? bg(1) : ink(0.7), border: `1px solid ${ink(0.1)}` }}>
              {n.n}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: 'hsl(var(--raised))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={n.icon} />
              </div>
              <div style={{ fontSize: 27, letterSpacing: '-0.02em', color: ink(0.95), fontWeight: 500, whiteSpace: 'nowrap' }}>
                {n.title}
                {n.tag ? <span style={{ marginLeft: 10, fontSize: 17, fontWeight: 400, color: ink(0.5), letterSpacing: 0 }}>{n.tag}</span> : null}
              </div>
            </div>
            <div style={{ marginTop: 10, fontSize: 20, lineHeight: 1.3, color: ink(0.55), letterSpacing: '-0.01em' }}>{n.sub}</div>
          </div>
        )
      })}
    </AbsoluteFill>
  )
}

/** `cardH` makes room for a sentence under each title instead of a few words. */
export function FlowGraph({ nodes, edges, label, cardH }: { nodes: GraphNode[]; edges: GraphEdge[]; label: string; cardH?: number }) {
  return (
    <div className="relative w-full overflow-hidden rounded-[28px] border border-line">
      <div role="img" aria-label={label}>
      <Player
        component={Scene}
        inputProps={{ nodes, edges, ...(cardH ? { cardH } : {}) }}
        durationInFrames={LOOP}
        fps={FPS}
        compositionWidth={W}
        compositionHeight={H}
        style={{ width: '100%', aspectRatio: `${W} / ${H}` }}
        autoPlay
        loop
        controls={false}
        clickToPlay={false}
        doubleClickToFullscreen={false}
        spaceKeyToPlayOrPause={false}
        initiallyMuted
      />
      </div>
      {/* The composition is a video; a linked card gets a transparent link laid over it. */}
      {nodes.filter((n) => n.href).map((n) => (
        <a
          key={n.id}
          href={n.href}
          aria-label={`Open ${n.title}`}
          className="absolute rounded-[5%] outline-none ring-ink/40 transition hover:bg-ink/[0.04] focus-visible:ring-2"
          style={{ left: `${((n.x - cw(n) / 2) / W) * 100}%`, top: `${((n.y - (cardH ?? CARD_H) / 2) / H) * 100}%`, width: `${(cw(n) / W) * 100}%`, height: `${((cardH ?? CARD_H) / H) * 100}%` }}
        />
      ))}
    </div>
  )
}

/** The review loop, as the six steps a claim passes through. */
export const LOOP_NODES: GraphNode[] = [
  { id: 'obs', n: 1, title: 'Observation', sub: 'from an app you connected', x: 200, y: 380, icon: 'doc' },
  { id: 'prop', n: 2, title: 'The proposal', sub: 'one claim, with its source', x: 620, y: 150, icon: 'pen' },
  { id: 'find', n: 3, title: 'Automated findings', sub: 'duplicates, contradictions', x: 620, y: 610, icon: 'calc' },
  { id: 'rev', n: 4, title: 'Your review', sub: 'approve, reject, or it lands', x: 1070, y: 150, icon: 'people' },
  { id: 'seal', n: 5, title: 'Sealed', sub: 'encrypted, per-namespace key', x: 1070, y: 610, icon: 'key' },
  { id: 'name', n: 6, title: 'Your ENS name', sub: 'one signature, on chain', x: 1545, y: 380, icon: 'flag', final: true },
]

export const LOOP_EDGES: GraphEdge[] = [
  { from: 'obs', to: 'prop', at: 20 },
  { from: 'obs', to: 'find', at: 32 },
  { from: 'prop', to: 'rev', at: 70 },
  { from: 'find', to: 'seal', at: 82 },
  { from: 'prop', to: 'seal', at: 96 },
  { from: 'find', to: 'rev', at: 108 },
  { from: 'rev', to: 'name', solid: true, at: 150 },
  { from: 'seal', to: 'name', solid: true, at: 162 },
]
