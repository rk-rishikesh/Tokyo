/**
 * The pipeline, as nodes on a canvas.
 *
 * The reference builds a workflow left to right — a trigger, then steps, joined
 * by arrows. This product already *is* that shape and had been rendering it as
 * stacked cards: sources are observed, findings are judged, what survives is
 * committed to a namespace, and an agent reads it back.
 *
 * Every number here is counted from what actually happened rather than
 * illustrated. A canvas showing a healthy pipeline over an empty namespace
 * would be the same lie as a fake screenshot.
 */
import Link from 'next/link'

export type Stage = {
  id: string
  label: string
  glyph: string
  detail: string
  /** The count that makes this stage real, or null when nothing has happened. */
  count: number | null
  href?: string
  tone?: 'plain' | 'accent' | 'dim'
}

export function Canvas({ stages, namespace }: { stages: Stage[]; namespace: string }) {
  return (
    <div className="relative flex h-full w-full flex-col overflow-auto bg-[radial-gradient(hsl(var(--line))_1px,transparent_1px)] [background-size:22px_22px]">
      <div className="flex flex-1 items-center overflow-x-auto px-6 py-12">
        <div className="mx-auto flex flex-nowrap items-start">
          {stages.map((s, i) => (
            <div key={s.id} className="flex items-start">
              <Node stage={s} />
              {i < stages.length - 1 ? <Arrow /> : null}
            </div>
          ))}
        </div>
      </div>

      {/* In the flow, under the stages — it used to be pinned where the prompt bar sits. */}
      <p className="pb-5 text-center text-[13px] text-dim">
        everything here is written to <span className="font-mono text-ink">{namespace}</span>
      </p>
    </div>
  )
}

function Node({ stage }: { stage: Stage }) {
  const tone =
    stage.tone === 'accent'
      ? 'border-accent/45 bg-accent-soft'
      : stage.tone === 'dim'
        ? 'border-line bg-raised/40'
        : 'border-line bg-surface'

  const body = (
    <div className="w-[112px] text-center">
      <div
        className={`mx-auto flex h-[52px] w-[52px] items-center justify-center rounded-2xl border text-[20px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_10px_28px_-14px_rgba(0,0,0,0.18)] transition-transform group-hover:-translate-y-0.5 ${tone}`}
        aria-hidden
      >
        <span className="grayscale">{stage.glyph}</span>
      </div>
      <p className="mt-2 text-[13px] font-medium leading-tight">{stage.label}</p>
      <p className="mt-0.5 text-[11.5px] leading-snug text-dim">
        {stage.count === null ? stage.detail : `${stage.count.toLocaleString()} ${stage.detail}`}
      </p>
    </div>
  )

  return stage.href ? (
    <Link href={stage.href} className="group block">{body}</Link>
  ) : (
    <div className="group">{body}</div>
  )
}

function Arrow() {
  return (
    <div className="mt-[26px] flex w-[36px] shrink-0 items-center px-1" aria-hidden>
      <span className="h-px flex-1 bg-line" />
      <span className="-ml-1 text-[9px] leading-none text-line">▶</span>
    </div>
  )
}
