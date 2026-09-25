/**
 * Diff between two snapshots, by memory id.
 *
 * Knowledge-level, not text-level: the unit a human reasons about is "this fact
 * changed", and a field-level list says which part.
 */
import { canonicalJson, type Knowledge, type Snapshot } from './objects.js'

export type FieldChange = { field: keyof Knowledge; before: unknown; after: unknown }

export type MemoryChange =
  | { kind: 'added'; id: string; after: Knowledge }
  | { kind: 'removed'; id: string; before: Knowledge }
  | { kind: 'changed'; id: string; before: Knowledge; after: Knowledge; fields: FieldChange[] }

export type SnapshotDiff = {
  changes: MemoryChange[]
  added: number
  removed: number
  changed: number
}

const FIELDS: (keyof Knowledge)[] = [
  'claim', 'subject', 'type', 'topic', 'confidence', 'sources', 'contributor', 'reviewers', 'tags', 'updated_at',
]

export function fieldChanges(before: Knowledge, after: Knowledge): FieldChange[] {
  return FIELDS.filter((f) => canonicalJson(before[f]) !== canonicalJson(after[f])).map(
    (field) => ({ field, before: before[field], after: after[field] }),
  )
}

export function diffSnapshots(before: Snapshot, after: Snapshot): SnapshotDiff {
  const changes: MemoryChange[] = []
  for (const id of Object.keys(after).sort()) {
    const a = after[id]!
    const b = before[id]
    if (!b) changes.push({ kind: 'added', id, after: a })
    else {
      const fields = fieldChanges(b, a)
      if (fields.length) changes.push({ kind: 'changed', id, before: b, after: a, fields })
    }
  }
  for (const id of Object.keys(before).sort()) {
    if (!(id in after)) changes.push({ kind: 'removed', id, before: before[id]! })
  }
  return {
    changes,
    added: changes.filter((c) => c.kind === 'added').length,
    removed: changes.filter((c) => c.kind === 'removed').length,
    changed: changes.filter((c) => c.kind === 'changed').length,
  }
}

/** A unified-diff-style rendering, for the CLI. */
export function renderDiff(diff: SnapshotDiff): string {
  if (!diff.changes.length) return '(no changes)'
  const lines: string[] = []
  for (const c of diff.changes) {
    if (c.kind === 'added') lines.push(`+ ${c.after.claim}${ctx(c.after)}`)
    else if (c.kind === 'removed') lines.push(`- ${c.before.claim}${ctx(c.before)}`)
    else {
      lines.push(`~ ${c.id}`)
      for (const f of c.fields) {
        lines.push(`  - ${String(f.field)}: ${fmt(f.before)}`)
        lines.push(`  + ${String(f.field)}: ${fmt(f.after)}`)
      }
    }
  }
  return lines.join('\n')
}

const ctx = (m: Knowledge) => `${m.subject ? `  (${m.subject})` : ''}${m.topic ? `  [${m.topic}]` : ''}`
const fmt = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v))
