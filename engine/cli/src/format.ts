import { renderConflict, renderDiff, renderFindings, renderWhy, shortId, type Commit, type Hit, type Knowledge, type Proposal, type Provenance, type SnapshotDiff } from '@recall/core'

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`

const STATUS: Record<Proposal['status'], string> = {
  draft: dim('DRAFT'), proposed: yellow('PROPOSED'), 'under-review': yellow('UNDER REVIEW'),
  approved: green('APPROVED'), committed: green('COMMITTED'), rejected: red('REJECTED'),
}

export const fmt = {
  commit: (c: Commit, opts: { head?: boolean; version?: number } = {}) =>
    `${yellow(shortId(c.id))}${opts.version ? dim(`  v${opts.version}`) : ''}  ${c.message}${opts.head ? dim('  (HEAD)') : ''}${c.proposal ? dim('  via review') : ''}\n${dim(`         ${c.author} · ${c.timestamp.slice(0, 19).replace('T', ' ')} · +${c.changes.added.length} ~${c.changes.updated.length} -${c.changes.removed.length}`)}`,
  knowledge: (k: Knowledge, extra = '') =>
    `${k.subject ? bold(k.subject) + dim(' — ') : ''}${k.claim}${k.topic ? dim(`  [${k.topic}]`) : ''}${extra}\n${dim(`  ${k.id} · ${k.type} · ${Math.round(k.confidence * 100)}% · ${k.sources.length} source${k.sources.length === 1 ? '' : 's'} · by ${k.contributor}${k.reviewers.length ? ` · reviewed by ${k.reviewers.join(', ')}` : ' · unreviewed'}`)}`,
  hit: (h: Hit) => fmt.knowledge(h.knowledge, dim(`  score ${h.score.toFixed(1)}`)),
  proposal: (p: Proposal) =>
    `${bold(`#${p.number}`)}  ${p.title}  ${STATUS[p.status]}\n${dim(`     ${p.author} · ${p.branch} → ${p.base} · ${p.reviews.filter((r) => r.verdict === 'approve').length} approval(s) · ${p.findings.length} finding(s) · ${p.createdAt.slice(0, 10)}`)}`,
  proposalDetail: (p: Proposal) => [
    fmt.proposal(p),
    ...(p.description ? ['', `  ${p.description}`] : []),
    '',
    `  ${renderFindings(p.findings).replace(/\n/g, '\n  ')}`,
    ...(p.reviews.length ? ['', '  reviews:', ...p.reviews.map((r) => `    ${r.verdict === 'approve' ? green('✓') : r.verdict === 'reject' ? red('✗') : dim('·')} ${r.reviewer}${r.comment ? ` — ${r.comment}` : ''} ${dim(r.at.slice(0, 16).replace('T', ' '))}`)] : []),
  ].join('\n'),
  diff: (d: SnapshotDiff) => renderDiff(d),
  why: (p: Provenance) => renderWhy(p),
  conflict: renderConflict,
  findings: renderFindings,
  ok: green, warn: yellow, err: red, dim, bold,
}
