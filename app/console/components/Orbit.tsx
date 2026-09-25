import { SOURCE_GLYPH } from '@/lib/glyphs'
import { WORKSPACES } from '@knowledge01/connect/workspaces'

/**
 * The hero visual: sources orbiting a namespace, with a claim arriving.
 *
 * The references all put the product itself in the hero rather than a diagram
 * of it — a phone with cards floating off it, app logos in orbit, UI fragments
 * scattered around the headline. This page had a flow chart, which explains the
 * architecture to someone already convinced.
 *
 * So: the things you connect, arranged around the thing they write into. Every
 * glyph is a source that genuinely exists, taken from the manifest rather than
 * drawn — a hero that advertised an integration we do not have would be the
 * same lie as a fake screenshot.
 *
 * Static and server-rendered. Motion here would be decoration, and the animated
 * flow diagram further down the page already carries that job.
 */

/** Where each source sits on the ring, in degrees clockwise from the top. */
const ANGLES = [0, 45, 90, 135, 180, 225, 270, 315]

export function Orbit({ namespace = 'you.eth' }: { namespace?: string }) {
  // Eight positions, filled from the manifest in declaration order.
  const nodes = WORKSPACES.slice(0, ANGLES.length).map((ws, i) => ({
    ws,
    angle: ANGLES[i]!,
  }))

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[540px]" aria-hidden>
      {/* Rings. Three, so the outer one reads as depth rather than a target. */}
      {[100, 76, 52].map((pct) => (
        <div
          key={pct}
          className="absolute rounded-full border border-line/60"
          style={{ inset: `${(100 - pct) / 2}%` }}
        />
      ))}

      {/* The centre: a namespace, with what it holds. */}
      <div className="absolute left-1/2 top-1/2 w-[58%] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line bg-surface p-4 text-center shadow-[0_2px_4px_rgba(0,0,0,0.03),0_12px_32px_-16px_rgba(0,0,0,0.12)]">
        <p className="truncate font-mono text-[13.5px] text-dim">{namespace}</p>
        <p className="mt-1 font-display text-[22px] leading-tight sm:text-[26px]">Your memory</p>
        <div className="mt-3 space-y-1.5 text-left">
          {[
            ['Works on Loops House', 'Browser history'],
            ['Writes TypeScript', 'GitHub'],
            ['Works with Sarah', 'Granola'],
          ].map(([claim, from]) => (
            <div key={claim} className="rounded-lg border border-line/70 bg-raised/40 px-2.5 py-1.5">
              <p className="truncate text-[13px] leading-snug">{claim}</p>
              <p className="truncate text-[12px] text-dim">from {from}</p>
            </div>
          ))}
        </div>
      </div>

      {/* The sources, on the ring. */}
      {nodes.map(({ ws, angle }) => {
        const rad = ((angle - 90) * Math.PI) / 180
        const r = 46 // percent of half-width — just inside the outer ring
        return (
          <div
            key={ws.id}
            className="absolute flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface text-[18px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_6px_16px_-8px_rgba(0,0,0,0.12)]"
            style={{
              left: `calc(50% + ${Math.cos(rad) * r}% - 22px)`,
              top: `calc(50% + ${Math.sin(rad) * r}% - 22px)`,
            }}
            title={ws.name}
          >
            {ws.glyph}
          </div>
        )
      })}
    </div>
  )
}

/**
 * The same idea in one line, for places that need the claim rather than the
 * picture: which kinds of source can write, named by what they are.
 */
export function SourceKinds() {
  const kinds = ['human', 'document', 'api', 'agent', 'application'] as const
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[14px] text-dim">
      {kinds.map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span aria-hidden>{SOURCE_GLYPH[k]}</span>
          {k === 'api' ? 'APIs' : `${k.charAt(0).toUpperCase()}${k.slice(1)}s`}
        </span>
      ))}
    </div>
  )
}
