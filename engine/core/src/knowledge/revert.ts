/**
 * Revert: undo one commit's changes with a new commit.
 *
 * History-preserving on purpose (principle 5.1: never silently destroy state).
 * The reverted commit stays in the log; a new commit applies its inverse.
 */
import { canonicalJson, type Commit, type Snapshot } from './objects.js'

export type RevertConflict = { id: string; reason: string }

export type RevertResult = { snapshot: Snapshot; conflicts: RevertConflict[] }

export function revertCommit(
  target: Commit,
  targetParent: Snapshot,
  current: Snapshot,
): RevertResult {
  const snapshot: Snapshot = { ...current }
  const conflicts: RevertConflict[] = []
  const eq = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b)

  for (const id of target.changes.added) {
    if (!(id in current)) continue // already gone
    if (!eq(current[id], target.snapshot[id])) {
      conflicts.push({ id, reason: 'changed since it was added; refusing to remove a newer version' })
      continue
    }
    delete snapshot[id]
  }
  for (const id of target.changes.removed) {
    if (id in current) { conflicts.push({ id, reason: 'exists again; not overwriting' }); continue }
    if (targetParent[id]) snapshot[id] = targetParent[id]!
  }
  for (const id of target.changes.updated) {
    if (!(id in current)) { conflicts.push({ id, reason: 'no longer present' }); continue }
    if (!eq(current[id], target.snapshot[id])) {
      conflicts.push({ id, reason: 'changed again since that commit; resolve by hand' })
      continue
    }
    if (targetParent[id]) snapshot[id] = targetParent[id]!
  }
  return { snapshot, conflicts }
}
