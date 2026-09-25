import Link from 'next/link'
import type { ActivityEntry } from '@recall/connect'
import { Nothing } from '@/components/ui'

/**
 * What the agent saw, and what it did about it.
 *
 * Skips are shown as well as writes. An agent that keeps everything is the
 * failure mode this product argues against, so the things it decided not to
 * remember are part of the evidence that it is working — not noise to hide.
 */
export function Feed({ activity, ago }: { activity: ActivityEntry[]; ago: (iso: string) => string }) {
  if (!activity.length) {
    return (
      <Nothing title="Nothing observed yet">
        Connect a source above. The agent starts watching on its own — use a site or push a commit and it will appear
        here within a minute or two.
      </Nothing>
    )
  }
  return (
    <div className="space-y-2">
      {activity.map((a) => {
        const o = a.outcome
        const committed = o.status === 'committed'
        // `unchanged` means the claim is already held, from this source, at this
        // confidence — it is in memory, so it must not be struck out like
        // something the agent rejected.
        const kept = committed || o.status === 'unchanged'
        return (
          <div key={a.id} className={`rounded-2xl border bg-surface p-3.5 ${committed ? 'border-line' : 'border-line/60'}`}>
            <p className={`text-[14px] leading-relaxed ${kept ? '' : 'text-dim line-through'}`}>{a.event.text}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[12.5px] text-dim">
              <span className="font-medium text-ink">{a.event.sourceName}</span>·<span>{a.event.trigger}</span>·<span>{ago(a.at)}</span>
              {a.event.trigger.includes('read by') ? <span className="rounded bg-accent/10 px-1 py-px text-[12px] text-accent">model</span> : null}
            </p>
            <p className="mt-1.5 text-[13px]">
              {committed && o.status === 'committed' ? (
                <>
                  <span className="text-accent">→ remembered</span>{' '}
                  <Link href={`/k/${encodeURIComponent(o.namespace)}`} className="font-mono text-accent hover:underline">{o.namespace}</Link>{' '}
                  <span className="text-dim">v{o.version}{o.merged ? ' · merged with an existing claim' : ''}</span>
                </>
              ) : o.status === 'unchanged' ? (
                <>
                  <span className="text-dim">→ already known in</span>{' '}
                  <Link href={`/k/${encodeURIComponent(o.namespace)}`} className="font-mono text-dim hover:underline">{o.namespace}</Link>{' '}
                  <span className="text-dim">· nothing to commit</span>
                </>
              ) : o.status === 'skipped' ? <span className="text-dim">→ skipped: {o.reason}</span>
                : <span className="text-removed">→ error: {o.status === 'error' ? o.reason : o.status}</span>}
            </p>
          </div>
        )
      })}
    </div>
  )
}
