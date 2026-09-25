import { topicLabel, typeLabel } from '@knowledge01/connect/topics'
/**
 * Turn commits into sentences a memory owner can read.
 *
 * The owner never sees a commit id or a CID. They see "Your preference changed",
 * who changed it, and when. Everything here is derived from the same objects the
 * developer view shows as diffs — it is a relabelling, not a different record.
 */
import type { Commit, Knowledge as Memory } from '@knowledge01/core'
import type { RepoView } from './repoview'

export type Event = {
  kind: 'learned' | 'changed' | 'forgot' | 'combined' | 'undid'
  headline: string
  before?: Memory
  after?: Memory
  by: string
  at: string
  /** For the developer link. */
  commitId: string
}

/**
 * Topic and type labels come from the shared registry.
 *
 * These were two maps maintained here by hand, and they shared no keys at all
 * with what the connectors produce: `codebase`, `shopping` and `ops` against
 * `projects`, `tools` and `conventions`. Every connector-written claim fell
 * through to the capitalise fallback, so the interface was labelling namespaces
 * by accident. `humanType` was also missing `convention` and `policy`, which
 * rendered raw.
 */
export const humanTopic = (c: string | null | undefined): string => topicLabel(c)

export const humanType = (t: string): string => typeLabel(t)

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60); if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.floor(h / 24); if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`
  return iso.slice(0, 10)
}

export function narrate(view: RepoView, commits: Commit[]): Event[] {
  const events: Event[] = []
  for (const c of commits) {
    const parent = c.parents[0] ? view.commits[c.parents[0]] : undefined
    const base = { by: c.author, at: c.timestamp, commitId: c.id }
    if (c.message.startsWith('Revert ')) { events.push({ ...base, kind: 'undid', headline: 'A change was undone' }); continue }
    if (c.parents.length > 1) events.push({ ...base, kind: 'combined', headline: `Lessons from “${view.commits[c.parents[1]!]?.branch ?? 'another line'}” were combined in` })
    for (const id of c.changes.updated) {
      const before = parent?.snapshot[id]; const after = c.snapshot[id]
      if (!after) continue
      const what = before && before.claim !== after.claim ? `Your ${humanType(after.type)} changed` : `A ${humanType(after.type)} was updated`
      events.push({ ...base, kind: 'changed', headline: what, ...(before ? { before } : {}), after })
    }
    for (const id of c.changes.added) { const after = c.snapshot[id]; if (after) events.push({ ...base, kind: 'learned', headline: `New ${humanType(after.type)}`, after }) }
    for (const id of c.changes.removed) { const before = parent?.snapshot[id]; if (before) events.push({ ...base, kind: 'forgot', headline: 'Forgotten', before }) }
  }
  return events
}

/** Which apps and agents have written into this memory. */
export function writers(view: RepoView): { agent: string; writes: number; last: string; memories: number }[] {
  const byAgent = new Map<string, { writes: number; last: string; memories: Set<string> }>()
  for (const c of Object.values(view.commits)) {
    const e = byAgent.get(c.author) ?? { writes: 0, last: c.timestamp, memories: new Set<string>() }
    e.writes++; if (c.timestamp > e.last) e.last = c.timestamp
    for (const id of [...c.changes.added, ...c.changes.updated]) e.memories.add(id)
    byAgent.set(c.author, e)
  }
  return [...byAgent.entries()].map(([agent, e]) => ({ agent, writes: e.writes, last: e.last, memories: e.memories.size })).sort((a, b) => b.last.localeCompare(a.last))
}
