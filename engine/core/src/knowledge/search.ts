/**
 * Keyword search over a snapshot.
 *
 * Deliberately small. A personal memory namespace is hundreds of short facts,
 * not millions of documents; a scored keyword match with a context filter is
 * enough, needs no index build and no provider, and behaves predictably.
 * Semantic search sits behind the same signature when it is wanted.
 */
import type { Knowledge, Snapshot } from './objects.js'

export type SearchOptions = { topic?: string | null; subject?: string; type?: string; limit?: number; minConfidence?: number }
export type Hit = { knowledge: Knowledge; score: number }

const tokens = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1)

export function searchSnapshot(snapshot: Snapshot, query: string, opts: SearchOptions = {}): Hit[] {
  const q = tokens(query)
  const hits: Hit[] = []
  for (const m of Object.values(snapshot)) {
    if (opts.topic !== undefined && m.topic !== opts.topic) continue
    if (opts.type && m.type !== opts.type) continue
    if (opts.subject && (m.subject ?? '').toLowerCase() !== opts.subject.toLowerCase()) continue
    if (opts.minConfidence !== undefined && m.confidence < opts.minConfidence) continue
    const hay = tokens(`${m.claim} ${m.subject ?? ''} ${m.tags.join(' ')} ${m.type} ${m.topic ?? ''}`)
    let score = 0
    for (const t of q) {
      if (hay.includes(t)) score += 2
      else if (hay.some((h) => h.startsWith(t) || t.startsWith(h))) score += 1
    }
    if (q.length === 0 || score > 0) hits.push({ knowledge: m, score: score * (0.5 + m.confidence / 2) })
  }
  return hits.sort((a, b) => b.score - a.score || a.knowledge.created_at.localeCompare(b.knowledge.created_at)).slice(0, opts.limit ?? 10)
}
