import { chainStatus, pendingOf } from '@knowledge01/connect'
import { PublishToChain } from './PublishToChain'

/**
 * How far the chain is behind what is staged here, and the button that closes
 * the gap. Read from the chain on every render, so it cannot claim something
 * is published that is not.
 */
export async function ChainPanel({ owner, compact }: { owner: string; compact?: boolean }) {
  const [s, diff] = await Promise.all([chainStatus(owner), pendingOf(owner).catch(() => [])])
  if (!s.ok) {
    return (
      <div className="rounded-[28px] border border-dashed border-line p-6 text-[14.5px] text-dim">
        <p className="text-[12.5px] uppercase tracking-[0.14em]">publish to your name</p>
        <p className="mt-1.5">Staged locally. The chain cannot be prepared yet: {s.reason}</p>
      </div>
    )
  }
  // What is waiting is the diff between your namespaces and your name, not what
  // has happened to be uploaded — a namespace never staged is still waiting.
  const pending = diff.filter((d) => d.commits.length || d.accessChanged).length
  const claims = diff.reduce((n, d) => n + d.commits.reduce((m, c) => m + c.added.length, 0), 0)
  const summary = pending
    ? `${claims ? `${claims} new claim${claims === 1 ? '' : 's'} in ` : ''}${pending} namespace${pending === 1 ? '' : 's'}, not on chain yet`
    : undefined
  const urgent = s.revokedStillOnChain.length
    ? s.revokedStillOnChain.map((r) => `${r.agents.join(', ')} on ${r.namespace}.`).join(' ')
    : undefined
  return <PublishToChain pending={pending} {...(summary ? { summary } : {})} setup={s.plan.setupRemaining} {...(urgent ? { urgent } : {})} {...(compact ? { compact } : {})} />
}
