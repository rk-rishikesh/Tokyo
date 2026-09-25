/**
 * The questions the owner has to answer, and the one-click answers.
 *
 * Automated review raises findings — "may contradict", "duplicate", "no
 * source" — and the explorer showed them as a commit log with a CLI command to
 * run. That is the machinery, not the question. Here each finding is phrased as
 * the question it is really asking, with the two claims side by side, and
 * answered by picking what is true:
 *
 *   Do these disagree?   Both are true · The new one replaces the old · Keep the old one
 *   Same thing twice?    Merge them · Keep both
 *   Anything else        Keep it · Remove it
 *
 * Every answer is an ordinary commit (so history keeps what was removed) and
 * settles exactly that finding. The commit an answer makes is the owner's own
 * explicit decision, so the findings it would raise about itself are cleared.
 */
import type { Finding, Knowledge } from '@knowledge01/core'
import { Repository } from '@knowledge01/repo'
import { namespacesOf } from './sharing.js'

export type DecisionKind = 'conflict' | 'duplicate' | 'check'

export type Answer = 'both' | 'replace' | 'keep-old' | 'merge' | 'keep' | 'remove'

export type Decision = {
  namespace: string
  commit: string
  index: number
  kind: DecisionKind
  /** The question, in plain words. */
  question: string
  /** One line saying why it was asked. */
  why: string
  claim: Pick<Knowledge, 'id' | 'claim' | 'sources' | 'confidence' | 'created_at'>
  /** The claim it is compared with, for conflicts and duplicates. */
  other?: Pick<Knowledge, 'id' | 'claim' | 'sources' | 'confidence' | 'created_at'>
  answers: { id: Answer; label: string }[]
  at: string
}

const pick = (k: Knowledge) => ({ id: k.id, claim: k.claim, sources: k.sources, confidence: k.confidence, created_at: k.created_at })

function phrase(f: Finding): { kind: DecisionKind; question: string; why: string; answers: Decision['answers'] } {
  switch (f.kind) {
    case 'contradiction':
    case 'supersession':
      return {
        kind: 'conflict',
        question: 'Do these disagree?',
        why: 'They are about the same thing and say different things.',
        answers: [
          { id: 'both', label: 'Both are true' },
          { id: 'replace', label: 'New one replaces the old' },
          { id: 'keep-old', label: 'Keep the old one' },
        ],
      }
    case 'duplicate':
      return {
        kind: 'duplicate',
        question: 'Same thing twice?',
        why: 'These say almost the same thing.',
        answers: [
          { id: 'merge', label: 'Merge them' },
          { id: 'keep', label: 'Keep both' },
        ],
      }
    case 'missing-sources':
      return { kind: 'check', question: 'Keep this without a source?', why: 'Nothing says where this came from.', answers: [{ id: 'keep', label: 'Keep it' }, { id: 'remove', label: 'Remove it' }] }
    case 'low-confidence':
      return { kind: 'check', question: 'Keep this?', why: 'There is little evidence behind it.', answers: [{ id: 'keep', label: 'Keep it' }, { id: 'remove', label: 'Remove it' }] }
    case 'removal':
      return { kind: 'check', question: 'Was this meant to go?', why: 'A claim was removed.', answers: [{ id: 'keep', label: 'Yes, it is gone' }] }
    default:
      return { kind: 'check', question: 'Keep this change?', why: 'It changed without a new source.', answers: [{ id: 'keep', label: 'Keep it' }, { id: 'remove', label: 'Remove it' }] }
  }
}

/** Every open question across this owner's namespaces, newest first. */
export function decisionsOf(owner: string): Decision[] {
  const out: Decision[] = []
  for (const namespace of namespacesOf(owner)) {
    const repo = Repository.open(namespace)
    const head = repo.headSnapshot(repo.refs.head)
    for (const { commit, findings } of repo.findings()) {
      findings.forEach((f, index) => {
        // Look the claims up where they are now, falling back to where they were.
        const k = head[f.id] ?? commit.snapshot[f.id]
        if (!k) return
        const other = f.related ? head[f.related] ?? commit.snapshot[f.related] : undefined
        // A conflict or duplicate whose other half is already gone has nothing left to decide.
        if ((f.kind === 'contradiction' || f.kind === 'duplicate' || f.kind === 'supersession') && (!other || !head[f.id] || !head[f.related!])) return
        out.push({ namespace, commit: commit.id, index, ...phrase(f), claim: pick(k), ...(other ? { other: pick(other) } : {}), at: commit.timestamp })
      })
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at))
}

const quote = (s: string) => `“${s.length > 60 ? `${s.slice(0, 59)}…` : s}”`

/** Apply an answer: change the namespace if the answer says to, then settle the finding. */
export function answerDecision(owner: string, namespace: string, commitId: string, index: number, answer: Answer): void {
  if (!namespacesOf(owner).includes(namespace)) throw new Error(`${namespace} is not yours`)
  const repo = Repository.open(namespace)
  repo.actingAs = repo.policy.owner
  const f = repo.store.readRefs().findings[commitId]?.[index]
  if (!f) return // already settled
  const head = repo.headSnapshot(repo.refs.head)
  const k = head[f.id]
  const other = f.related ? head[f.related] : undefined

  let message: string | null = null
  if (answer === 'replace' && other && k) {
    repo.remove(other.id)
    message = `Replaced ${quote(other.claim)} with ${quote(k.claim)}`
  } else if (answer === 'keep-old' && k) {
    repo.remove(k.id)
    message = `Kept ${quote(other?.claim ?? '')}; removed ${quote(k.claim)}`
  } else if (answer === 'merge' && k && other) {
    const seen = new Set(other.sources.map((s) => JSON.stringify(s)))
    repo.update(other.id, { sources: [...other.sources, ...k.sources.filter((s) => !seen.has(JSON.stringify(s)))] })
    repo.remove(k.id)
    message = `Merged ${quote(k.claim)} into ${quote(other.claim)}`
  } else if (answer === 'remove' && k) {
    repo.remove(k.id)
    message = `Removed ${quote(k.claim)}`
  }

  if (message) {
    const c = repo.commit(message, { author: repo.policy.owner })
    // The owner's own decision: nothing about it needs a second decision.
    repo.resolveFindings(c.id)
  }
  repo.resolveFinding(commitId, index)
}
