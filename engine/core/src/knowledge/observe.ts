/**
 * Observation → knowledge proposal (the ingestion pipeline).
 *
 * An application sees things ("user viewed Nike Pegasus three times"); not every
 * one of them deserves to be remembered, and some contradict what is already
 * known. This turns an observation into a *proposal* against the current
 * snapshot, so a developer can configure "observe everything, commit above 80%"
 * and a memory owner can be shown "your preference changed" instead of a diff.
 *
 * Pure: no I/O. `Repository.observe` applies the proposal.
 */
import { newKnowledge, type Knowledge, type NewKnowledge, type Snapshot } from './objects.js'

export type ObservationAction =
  /** New knowledge; nothing similar exists in this context. */
  | 'add'
  /** Contradicts an existing memory and is at least as confident: supersede it. */
  | 'update'
  /** Already known with the same content. Confidence may be reinforced. */
  | 'known'
  /** Contradicts an existing memory but is less confident: leave for a human. */
  | 'conflict'
  /** Observed, but below the confidence threshold to commit. */
  | 'below-threshold'

export type Observation = {
  action: ObservationAction
  /** What would be committed (for update: the existing id with new content). */
  knowledge: Knowledge
  /** The memory this observation reinforces, supersedes or conflicts with. */
  existing?: Knowledge
  /** 0..1 token overlap with `existing`, when one was found. */
  similarity?: number
  /** One sentence a person can read. */
  reason: string
}

export type ObserveOptions = {
  /** Commit only at or above this confidence. Default 0.8. */
  threshold?: number
  /** Treat memories in the same context with at least this overlap as "about the same thing". Default 0.5. */
  similarity?: number
}

const normS = (s: string) => s.trim().toLowerCase()
const tokens = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2))

/** Jaccard overlap of the two contents' tokens. */
export function similarity(a: string, b: string): number {
  const ta = tokens(a); const tb = tokens(b)
  if (!ta.size || !tb.size) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  return inter / (ta.size + tb.size - inter)
}

export function proposeMemory(snapshot: Snapshot, input: NewKnowledge, opts: ObserveOptions = {}): Observation {
  const threshold = opts.threshold ?? 0.8
  const minSim = opts.similarity ?? 0.5
  const candidate = newKnowledge({ ...input, sources: input.sources?.length ? input.sources : [{ type: 'observation' }] })

  const exact = snapshot[candidate.id]
  if (exact) {
    const reinforced = Math.max(exact.confidence, candidate.confidence)
    return {
      action: 'known',
      knowledge: { ...exact, confidence: reinforced, updated_at: candidate.created_at },
      existing: exact,
      similarity: 1,
      reason: reinforced > exact.confidence
        ? `Already known; confidence raised from ${pct(exact.confidence)} to ${pct(reinforced)}.`
        : 'Already known; nothing new.',
    }
  }

  // Nearest memory about the same thing, in the same context.
  let best: { m: Knowledge; s: number } | undefined
  for (const m of Object.values(snapshot)) {
    if ((m.topic ?? null) !== (candidate.topic ?? null)) continue
    if (m.subject && candidate.subject && normS(m.subject) !== normS(candidate.subject)) continue
    const sameSubject = !!(m.subject && candidate.subject && normS(m.subject) === normS(candidate.subject))
    const s = Math.max(similarity(m.claim, candidate.claim), sameSubject ? minSim : 0)
    if (s >= minSim && (!best || s > best.s)) best = { m, s }
  }

  if (candidate.confidence < threshold) {
    return {
      action: 'below-threshold', knowledge: candidate, ...(best ? { existing: best.m, similarity: best.s } : {}),
      reason: `Observed at ${pct(candidate.confidence)}, below the ${pct(threshold)} threshold to commit.`,
    }
  }

  if (!best) return { action: 'add', knowledge: candidate, reason: 'New; nothing similar in this context.' }

  if (candidate.confidence >= best.m.confidence) {
    return {
      action: 'update',
      knowledge: { ...best.m, claim: candidate.claim, confidence: candidate.confidence,  tags: candidate.tags.length ? candidate.tags : best.m.tags, updated_at: candidate.created_at },
      existing: best.m, similarity: best.s,
      reason: `Supersedes "${best.m.claim}" (${pct(best.m.confidence)}) with a ${pct(candidate.confidence)} observation.`,
    }
  }
  return {
    action: 'conflict', knowledge: candidate, existing: best.m, similarity: best.s,
    reason: `Contradicts "${best.m.claim}" (${pct(best.m.confidence)}) but is only ${pct(candidate.confidence)} confident; left for review.`,
  }
}

const pct = (n: number) => `${Math.round(n * 100)}%`
