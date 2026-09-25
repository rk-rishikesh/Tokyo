/**
 * Three-way merge of snapshots, by memory id.
 *
 * Semantic rather than textual: the question per memory is "who changed it
 * since we diverged", not "which lines differ". Where both sides changed the
 * same memory differently, it is a conflict and is *reported*, never guessed
 * at — a wrong merge of "likes blue" and "hates blue" is worse than asking.
 */
import { canonicalJson, mergeClaim, sameClaim, type Knowledge, type Snapshot } from './objects.js'

export type Conflict = {
  id: string
  base?: Knowledge
  ours?: Knowledge
  theirs?: Knowledge
  reason: 'both-changed' | 'both-added' | 'removed-vs-changed'
}

export type MergeResult = {
  snapshot: Snapshot
  conflicts: Conflict[]
  /** ids taken from theirs, for the commit message. */
  tookTheirs: string[]
}

export type Resolution = Record<string, 'ours' | 'theirs' | Knowledge>

const same = (a?: Knowledge, b?: Knowledge) =>
  (a === undefined && b === undefined) ||
  (a !== undefined && b !== undefined && canonicalJson(a) === canonicalJson(b))

export function threeWayMerge(
  base: Snapshot,
  ours: Snapshot,
  theirs: Snapshot,
  resolutions: Resolution = {},
): MergeResult {
  const ids = new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)])
  const snapshot: Snapshot = {}
  const conflicts: Conflict[] = []
  const tookTheirs: string[] = []

  for (const id of [...ids].sort()) {
    const b = base[id], o = ours[id], t = theirs[id]
    const oursChanged = !same(b, o)
    const theirsChanged = !same(b, t)

    const resolve = (c: Conflict) => {
      const r = resolutions[id]
      if (r === 'ours') { if (o) snapshot[id] = o; return }
      if (r === 'theirs') { if (t) { snapshot[id] = t; tookTheirs.push(id) } return }
      if (r && typeof r === 'object') { snapshot[id] = r; return }
      conflicts.push(c)
      if (o) snapshot[id] = o // keep ours in the working snapshot while unresolved
    }

    if (!oursChanged && !theirsChanged) { if (b) snapshot[id] = b; continue }
    if (oursChanged && !theirsChanged) { if (o) snapshot[id] = o; continue }
    if (!oursChanged && theirsChanged) { if (t) { snapshot[id] = t; tookTheirs.push(id) } continue }
    // both changed
    if (same(o, t)) { if (o) snapshot[id] = o; continue }
    // Same statement reached from two sides (PRD W3): merge the evidence, no conflict.
    if (o && t && sameClaim(o, t)) { snapshot[id] = mergeClaim(o, t).merged; tookTheirs.push(id); continue }
    if (!b) { resolve({ id, ours: o, theirs: t, reason: 'both-added' }); continue }
    if (!o || !t) { resolve({ id, base: b, ours: o, theirs: t, reason: 'removed-vs-changed' }); continue }
    resolve({ id, base: b, ours: o, theirs: t, reason: 'both-changed' })
  }
  return { snapshot, conflicts, tookTheirs }
}

/** Human rendering of a conflict, PRD §33 style. */
export function renderConflict(c: Conflict): string {
  const side = (label: string, m?: Knowledge) =>
    m ? `  ${label}: "${m.claim}"  (confidence ${Math.round(m.confidence * 100)}%${m.topic ? `, topic ${m.topic}` : ''}, ${m.sources.length} source${m.sources.length === 1 ? '' : 's'})`
      : `  ${label}: (removed)`
  return [`CONFLICT ${c.id} — ${c.reason}`, side('ours  ', c.ours), side('theirs', c.theirs),
    ...(c.base ? [side('base  ', c.base)] : [])].join('\n')
}
