/**
 * Automated review (PRD §24).
 *
 * Runs when a contribution is proposed and again when it is reviewed. It
 * compares what the proposal would change against the base branch and reports
 * findings: duplicates, contradictions, missing sources, low confidence,
 * removals. Advisory only — a human, or the namespace policy, decides. It uses
 * the same similarity the observation pipeline uses, so "these two claims are
 * about the same thing" means the same thing everywhere.
 */
import { diffSnapshots } from './diff.js'
import { similarity } from './observe.js'
import type { Finding, Knowledge, Snapshot } from './objects.js'

const norm = (s: string | null) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export function reviewChanges(base: Snapshot, proposed: Snapshot, opts: { similarity?: number; minConfidence?: number } = {}): Finding[] {
  const minSim = opts.similarity ?? 0.5
  const minConf = opts.minConfidence ?? 0.5
  const findings: Finding[] = []
  const diff = diffSnapshots(base, proposed)

  const nearest = (k: Knowledge): { m: Knowledge; s: number } | undefined => {
    let best: { m: Knowledge; s: number } | undefined
    for (const m of Object.values(base)) {
      if (m.id === k.id) continue
      if ((m.topic ?? null) !== (k.topic ?? null)) continue
      if (m.subject && k.subject && norm(m.subject) !== norm(k.subject)) continue
      // Same explicit subject in the same topic is "about the same thing" even when the words differ.
      const sameSubject = !!(m.subject && k.subject && norm(m.subject) === norm(k.subject))
      const s = Math.max(similarity(m.claim, k.claim), sameSubject ? minSim : 0)
      if (s >= minSim && (!best || s > best.s)) best = { m, s }
    }
    return best
  }

  // Removals explained by a supersession are expected, not findings.
  const superseded = new Set(Object.values(proposed).map((k) => k.supersedes).filter((x): x is string => !!x))

  for (const c of diff.changes) {
    if (c.kind === 'removed') {
      if (superseded.has(c.id)) continue
      findings.push({ kind: 'removal', id: c.id, blocking: c.before.reviewers.length > 0, message: `Removes "${c.before.claim}"${c.before.reviewers.length ? ` (approved by ${c.before.reviewers.join(', ')})` : ''}.` })
      continue
    }
    const k = c.after
    if (!k.sources.length) findings.push({ kind: 'missing-sources', id: k.id, message: `"${k.claim}" cites no sources.` })
    if (k.confidence < minConf) findings.push({ kind: 'low-confidence', id: k.id, message: `"${k.claim}" is only ${Math.round(k.confidence * 100)}% confident.` })
    if (c.kind === 'added') {
      if (k.supersedes) {
        const old = base[k.supersedes]
        findings.push({ kind: 'supersession', id: k.id, related: k.supersedes, message: old ? `Supersedes "${old.claim}" — a fact that changed, not a disagreement. The old claim is retired; history keeps it.` : `Marks itself as superseding ${k.supersedes}, which is not on the base.` })
        continue
      }
      const near = nearest(k)
      if (near) {
        const same = norm(near.m.claim) === norm(k.claim)
        findings.push({
          kind: same ? 'duplicate' : 'contradiction', id: k.id, related: near.m.id, similarity: near.s, blocking: !same,
          message: same
            ? `Duplicates existing "${near.m.claim}".`
            : `May contradict existing "${near.m.claim}" (${Math.round(near.s * 100)}% similar${near.m.reviewers.length ? `, approved by ${near.m.reviewers.join(', ')}` : ''}). Mark it \`supersedes\` if the fact changed.`,
        })
      }
    } else if (c.kind === 'changed') {
      const claimChanged = c.fields.some((f) => f.field === 'claim')
      const sourcesGrew = k.sources.length > c.before.sources.length
      if (claimChanged && !sourcesGrew) {
        findings.push({ kind: 'unsupported-change', id: k.id, related: k.id, message: `Changes the claim from "${c.before.claim}" to "${k.claim}" without adding a source.` })
      }
    }
  }
  return findings
}

/** One line per finding, for the CLI and the MCP server. */
export function renderFindings(findings: Finding[]): string {
  if (!findings.length) return 'automated review: no findings'
  return ['automated review:', ...findings.map((f) => `  [${f.kind}${f.blocking ? ' · blocking' : ''}] ${f.message}`)].join('\n')
}

export const blockingFindings = (fs: Finding[]): Finding[] => fs.filter((f) => f.blocking)
