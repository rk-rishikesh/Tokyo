'use client'

import { useState } from 'react'

/**
 * Holdings as vertical pill columns: one series, one hue. The largest holding
 * is set in full ink and the rest in a tint, so the eye lands on what
 * dominates. Height is share of value; tiny holdings keep a pill-sized floor
 * so they stay visible and hoverable.
 */
export type Bar = { symbol: string; units: number; usd: number; stable: boolean }

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
const pct = (n: number) => (n > 0 && n < 0.1 ? '<0.1%' : n < 1 ? `${n.toFixed(1)}%` : `${n.toFixed(0)}%`)

const H = 190
const FLOOR = 36

export function HoldingsBars({ bars }: { bars: Bar[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const total = bars.reduce((n, b) => n + b.usd, 0)
  const max = Math.max(...bars.map((b) => b.usd), 1)
  if (!bars.length) return <p className="text-[14px] text-dim">No priced holdings.</p>

  return (
    <div>
      <div className="flex items-end gap-3" style={{ height: H + 34 }} role="list" aria-label="Holdings by value">
        {bars.map((b, i) => {
          const share = total ? (b.usd / total) * 100 : 0
          const h = Math.max(FLOOR, (b.usd / max) * H)
          const top = i === 0
          return (
            <div key={b.symbol} role="listitem" className="relative flex min-w-0 flex-1 flex-col items-center justify-end" style={{ height: H + 34 }}
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0}
              aria-label={`${b.symbol}: ${b.units.toLocaleString('en-US', { maximumFractionDigits: 4 })}, ${usd(b.usd)}, ${pct(share)} of value`}>
              {/* The largest holding is labelled directly; the rest on hover. */}
              <span className={`mb-1.5 font-mono text-[12.5px] tabular-nums ${top || hover === i ? 'text-ink' : 'text-transparent'}`}>{pct(share)}</span>
              <div className={`w-full max-w-[84px] rounded-full transition-colors ${top ? 'bg-ink' : hover === i ? 'bg-ink/35' : 'bg-ink/15'}`} style={{ height: h }} />
              {hover === i ? (
                <div className="pointer-events-none absolute bottom-[calc(100%-8px)] z-10 whitespace-nowrap rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12.5px] shadow-md">
                  <p className="font-mono font-semibold">{b.symbol}</p>
                  <p className="text-dim">{b.units.toLocaleString('en-US', { maximumFractionDigits: 4 })} · <span className="text-ink">{usd(b.usd)}</span></p>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
      <div className="mt-3 flex gap-3">
        {bars.map((b) => (
          <div key={b.symbol} className="min-w-0 flex-1 text-center">
            <p className="truncate font-mono text-[12.5px] font-semibold tracking-wide text-dim">{b.symbol}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
