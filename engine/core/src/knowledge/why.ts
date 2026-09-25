/**
 * "Why does the agent know this?"
 *
 * The provenance trail for one memory: the commit that introduced it, the
 * commit that last changed it, and what the memory itself records about its
 * source. This is the debugging question that flat memory stores cannot answer.
 *
 * The walk covers the **whole** ancestry, not just the first-parent line. A
 * memory learned on a branch and merged into main was introduced by the branch
 * commit, not by the merge — the merge only carried it. A commit counts as
 * touching the memory when the memory differs from what *every* parent held;
 * a merge that merely inherits it from one side is not a revision.
 */
import { canonicalJson, type Commit, type Knowledge } from './objects.js'
import type { Lookup } from './graph.js'

export type Provenance = {
  knowledge: Knowledge
  /** Commit that last changed this memory, newest in the ancestry of `from`. */
  lastChanged: Commit | undefined
  /** Commit that first added it. */
  introduced: Commit | undefined
  /** Every commit in the ancestry that changed it, newest first. */
  history: Commit[]
}

function touched(c: Commit, lookup: Lookup, knowledgeId: string): boolean {
  const mine = canonicalJson(c.snapshot[knowledgeId] ?? null)
  if (c.parents.length === 0) return mine !== 'null'
  return c.parents.every((p) => canonicalJson(lookup(p)?.snapshot[knowledgeId] ?? null) !== mine)
}

export function why(lookup: Lookup, from: string, knowledgeId: string): Provenance | undefined {
  const head = lookup(from)
  const knowledge = head?.snapshot[knowledgeId]
  if (!knowledge) return undefined

  // Full ancestry, then order newest first by timestamp (ties: keep walk order).
  const seen = new Map<string, Commit>()
  const stack = [from]
  while (stack.length) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    const c = lookup(id)
    if (!c) continue
    seen.set(id, c)
    stack.push(...c.parents)
  }
  const history = [...seen.values()]
    .filter((c) => touched(c, lookup, knowledgeId))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  const introduced = [...history].reverse().find((c) => c.parents.every((p) => !lookup(p)?.snapshot[knowledgeId]))
  return { knowledge, lastChanged: history[0], introduced, history }
}

export function renderWhy(p: Provenance): string {
  const c = p.lastChanged
  const i = p.introduced
  return [
    `WHY is this known: "${p.knowledge.claim}"`,
    ...(p.knowledge.subject ? [`  subject:     ${p.knowledge.subject}`] : []),
    '',
    `  sources:     ${p.knowledge.sources.length ? '' : '(none)'}`,
    // Name first when there is one: a reader wants "ChatGPT", not "memory-export".
    ...p.knowledge.sources.map((s) => `               - ${s.name ?? s.type}${s.name ? ` (${s.type})` : ''}${s.title ? ` "${s.title}"` : ''}${s.id ? ` ${s.id}` : ''}${s.excerpt ? `\n                 "${s.excerpt}"` : ''}`),
    `  contributor: ${p.knowledge.contributor}`,
    `  reviewers:   ${p.knowledge.reviewers.length ? p.knowledge.reviewers.join(', ') : '(unreviewed)'}`,
    `  added:       ${i?.timestamp ?? p.knowledge.created_at}`,
    `  confidence:  ${Math.round(p.knowledge.confidence * 100)}%`,
    `  topic:       ${p.knowledge.topic ?? 'general'}`,
    `  introduced:  ${i ? `${i.id.slice(0, 7)}  "${i.message}"  on ${i.branch}` : '-'}`,
    ...(c && c.id !== i?.id ? [`  last change: ${c.id.slice(0, 7)}  "${c.message}"  on ${c.branch}`] : []),
    `  revisions:   ${p.history.length}`,
  ].join('\n')
}
