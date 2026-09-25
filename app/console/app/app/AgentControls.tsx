'use client'

import { AGENT } from '@knowledge01/connect/policy'
import { useEffect, useRef, useState } from 'react'
import { runAgent } from './actions'

/**
 * The agent runs on a timer, the way a memory platform runs on every turn of
 * its host application. Nothing here is a "read the next item" button: it polls,
 * diffs, and writes only what changed. The switch exists so a person can stop it,
 * not so they have to start it.
 */
export function AgentControls({ lastWrite, model }: { lastWrite?: string; model?: string | null }) {
  const [watching, setWatching] = useState(true)
  const [status, setStatus] = useState<string>('starting…')
  const [busy, setBusy] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!watching) { setStatus('paused'); if (timer.current) clearInterval(timer.current); return }
    let cancelled = false
    const run = async () => {
      if (busy) return
      setBusy(true)
      try {
        const r = await runAgent()
        if (cancelled) return
        setStatus(r.written
          ? `wrote ${r.written} new claim${r.written === 1 ? '' : 's'}${r.byModel ? ` (${r.byModel} the model found)` : ''}`
          : `watching · ${r.checked} patterns, nothing new`)
      } catch { if (!cancelled) setStatus('could not read sources') } finally { if (!cancelled) setBusy(false) }
    }
    void run()
    timer.current = setInterval(() => { void run() }, AGENT.pollSeconds * 1000)
    return () => { cancelled = true; if (timer.current) clearInterval(timer.current) }
    // `busy` deliberately excluded: including it would restart the interval on every pass.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watching])

  return (
    <div className="flex items-center gap-3 whitespace-nowrap">
      {/* Just a loader: the agent is either working or it is not. The last
          status stays available on hover and to screen readers. */}
      <span className="flex items-center" title={busy ? 'reading your sources…' : status} role="status" aria-label={busy ? 'reading your sources' : status}>
        {watching ? (
          <span className="flex items-center gap-[3px]" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span key={i} className={`h-1.5 w-1.5 rounded-full bg-ink ${busy ? 'kn-loader-dot' : 'kn-loader-dot kn-loader-idle'}`} style={{ animationDelay: `${i * 0.16}s` }} />
            ))}
          </span>
        ) : (
          <span className="h-1.5 w-1.5 rounded-full border border-ink/40" aria-hidden />
        )}
      </span>
      <button
        onClick={() => setWatching(!watching)}
        aria-label={watching ? 'Pause the agent' : 'Resume the agent'}
        title={watching ? 'Pause' : 'Resume'}
        className={`flex h-7 w-7 items-center justify-center rounded-full transition ${watching ? 'border border-line text-ink/70 hover:text-ink' : 'bg-ink text-bg'}`}
      >
        <svg viewBox="0 0 12 12" className="h-3 w-3" fill="currentColor" aria-hidden>
          {watching
            ? <><rect x="2.5" y="2" width="2.4" height="8" rx="0.8" /><rect x="7.1" y="2" width="2.4" height="8" rx="0.8" /></>
            : <path d="M3.5 2.2v7.6a.6.6 0 0 0 .9.5l6-3.8a.6.6 0 0 0 0-1L4.4 1.7a.6.6 0 0 0-.9.5z" />}
        </svg>
      </button>
      {lastWrite ? <span className="hidden text-[13.5px] text-dim lg:inline">last wrote {lastWrite}</span> : null}
    </div>
  )
}
