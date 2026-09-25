/**
 * The three objects in the version graph, and how they are identified.
 *
 * Git for agent memory, adapted rather than copied:
 *
 *   - a **Memory** is one atomic piece of knowledge ("User prefers dark blue"),
 *     with the provenance that lets a human ask *why does the agent know this*;
 *   - a **Commit** is an immutable snapshot of every memory on a branch at one
 *     moment, plus what changed and who changed it. Snapshots are inline: one
 *     object per commit, one fetch to restore any point in history;
 *   - **Refs** is the mutable index — branch name → commit id — and the only
 *     thing the ENS `contenthash` ever points at. Branches and commits are free
 *     to create locally; publishing is one pointer move.
 *
 * Identity is content-derived. A commit id is the SHA-256 of its canonical
 * form, so two agents that produce the same history produce the same ids, and
 * the id is independent of how the object was encrypted for storage.
 */
import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex } from '@noble/hashes/utils'

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

/** Where a memory came from. The first thing a human asks about a bad one. */
/** Where knowledge comes from (PRD: five ingestion methods). */
export type SourceKind = 'human' | 'document' | 'api' | 'agent' | 'application'
export const SOURCE_KINDS: SourceKind[] = ['human', 'document', 'api', 'agent', 'application']

export type Source = {
  /** e.g. "document", "url", "book", "paper", "conversation", "tool", "observation", "import" */
  type: string
  /** Which of the five ingestion methods produced it. Derived from `type` when absent. */
  kind?: SourceKind
  /** The source's name as people know it: "Wikipedia", "Weather API", "research-agent.eth". */
  name?: string
  /** Identifier within that type: a URL, DOI, ISBN, conversation id… */
  id?: string
  title?: string
  /** The passage the claim rests on. */
  excerpt?: string
}

/** Best-effort classification of a legacy `type` into one of the five kinds. */
export function sourceKind(s: Source): SourceKind {
  if (s.kind) return s.kind
  const t = s.type.toLowerCase()
  if (['human', 'conversation', 'user', 'interview', 'expert'].includes(t)) return 'human'
  if (['api', 'feed', 'dataset', 'weather', 'news', 'finance'].includes(t)) return 'api'
  if (['agent', 'observation', 'tool', 'inference'].includes(t)) return 'agent'
  if (['application', 'app', 'import', 'integration'].includes(t)) return 'application'
  return 'document'
}

/** A source connected to a namespace: Wikipedia → wikipedia.history.eth. One source may feed many namespaces. */
export type SourceConnection = {
  id: string
  name: string
  kind: SourceKind
  description?: string
  /** Contributor identity its imports are attributed to, e.g. "wikipedia-import". */
  contributor: string
  status: 'connected' | 'paused'
  connectedAt: string
  /** How many knowledge objects cite it — maintained by the repository. */
  objects?: number
}

/**
 * A knowledge object: one claim, about one subject, in one topic, with the
 * sources it rests on and the people who vouched for it.
 *
 * Personal memory is the same shape — a preference is a claim about a person,
 * with a conversation as its source. One primitive, many namespace types.
 */
export type Knowledge = {
  /** Stable id. Never rewritten — it is the key for diff, merge and revert. */
  id: string
  /** What the claim is about, e.g. "Indian Independence". Null for free-standing notes. */
  subject: string | null
  /** The statement itself. */
  claim: string
  /** fact | event | date | definition | preference | decision | procedure | note … */
  type: string
  /**
   * Where in the namespace this belongs, e.g. "independence" or "food.preferences".
   * The same claim can hold differently per topic; null means general.
   */
  topic: string | null
  /** 0..1 */
  confidence: number
  sources: Source[]
  /** Who contributed it — an ENS name or address. */
  contributor: string
  /** Who approved it into the branch it sits on. Filled by the review workflow. */
  reviewers: string[]
  tags: string[]
  /**
   * The claim this one replaces (PRD W3). Present, a differing statement on the
   * same subject is a supersession — a fact that changed — not a contradiction.
   * The superseded claim is retired from the snapshot; history keeps it.
   */
  supersedes?: string
  created_at: string
  updated_at?: string
}

/** A snapshot of every knowledge object on a branch at one commit, keyed by id. */
export type Snapshot = Record<string, Knowledge>

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

export type Changes = {
  added: string[]
  updated: string[]
  removed: string[]
}

export type Commit = {
  kind: 'commit'
  /** SHA-256 of the canonical commit without this field. */
  id: string
  /** Zero for a root, one normally, two for a merge. */
  parents: string[]
  branch: string
  author: string
  timestamp: string
  message: string
  changes: Changes
  snapshot: Snapshot
  /** Proposal this commit landed, when it came through review. */
  proposal?: string
}

// ---------------------------------------------------------------------------
// Refs
// ---------------------------------------------------------------------------

export type Refs = {
  kind: 'refs'
  /** The ENS name this graph is published under. */
  namespace: string
  /** Default branch. */
  head: string
  /** branch name → commit id */
  branches: Record<string, string>
  /**
   * commit id → storage ref (CID) for every published commit.
   *
   * This is what lets a reader fetch history: refs are the only thing the
   * contenthash points at, so everything reachable must be listed here.
   */
  objects: Record<string, string>
  /** Who may do what. Enforced by every repository acting on this namespace; the pointer itself is enforced by ENS. */
  policy: Policy
  /** Contributions and their review state, keyed by proposal id. Published so reviewers share one view. */
  proposals: Record<string, Proposal>
  /** Human title and description of the namespace. */
  title?: string
  description?: string
  /** Parent namespace, e.g. "history.eth" for "india.history.eth". */
  parent?: string
  /** Child namespaces registered under this one. */
  children: string[]
  /** Sources connected to this namespace, keyed by id. */
  sources: Record<string, SourceConnection>
  /**
   * Unresolved findings from commits that landed without a gate (PRD W2):
   * commit id → findings. The owner's review-later queue.
   */
  findings: Record<string, Finding[]>
  /**
   * Fork-and-pull outbox (PRD W5): proposals this namespace's owner has made
   * against other namespaces, published as bundles. target → bundle CIDs.
   */
  outbox: Record<string, string[]>
  updatedAt: string
}

/**
 * A proposal travelling between repositories (PRD W5, fork-and-pull): the
 * proposal record plus every commit its branch needs. Content-addressed like
 * everything else, so the owner can verify what they ingest.
 */
export type ProposalBundle = {
  kind: 'proposal-bundle'
  target: string
  proposal: Proposal
  commits: Commit[]
  from: string
  createdAt: string
}

// ---------------------------------------------------------------------------
// Policy — the four roles (PRD §9, §25)
// ---------------------------------------------------------------------------

export type Role = 'owner' | 'reviewer' | 'contributor' | 'reader'
export type Action = 'read' | 'propose' | 'review' | 'approve' | 'merge' | 'commit' | 'admin'

/** What the namespace is for. Sets the review defaults (PRD W2). */
export type NamespaceKind = 'public' | 'organisation' | 'personal'

/** How unmarked conflicts resolve when nobody is gating (PRD W3). */
export type ConflictPolicy = 'ask' | 'latest' | 'confidence'

/** When local commits become a published version (PRD W4). */
export type PublishPolicy = {
  mode: 'manual' | 'interval' | 'threshold'
  /** interval mode: publish when the oldest unpublished commit is this old. */
  intervalMinutes?: number
  /** threshold mode (also honoured in interval mode): publish at this many pending commits. */
  pendingCommits?: number
}

export type Policy = {
  owner: string
  kind: NamespaceKind
  reviewers: string[]
  /** Who may propose. "anyone" for a public, Wikipedia-like namespace. */
  contributors: 'anyone' | string[]
  /** "public": published in plaintext. "key": encrypted; readers hold the namespace key. */
  readers: 'public' | 'key'
  /**
   * Approvals a proposal needs before it can land. 0 = auto-land: proposals
   * with no blocking finding land on propose; findings are still recorded.
   */
  approvals: number
  /** Unmarked contradictions: ask (block), latest wins, or highest confidence wins. */
  conflicts: ConflictPolicy
  publish: PublishPolicy
  /** Approvals must carry a signature by the key that owns the reviewer's ENS name. */
  signedApprovals: boolean
}

export const POLICY_DEFAULTS: Record<NamespaceKind, Omit<Policy, 'owner' | 'reviewers' | 'readers'>> = {
  public:       { kind: 'public',       contributors: 'anyone', approvals: 1, conflicts: 'ask',    publish: { mode: 'manual' },                                   signedApprovals: false },
  organisation: { kind: 'organisation', contributors: [],       approvals: 1, conflicts: 'ask',    publish: { mode: 'interval', intervalMinutes: 60, pendingCommits: 20 }, signedApprovals: false },
  personal:     { kind: 'personal',     contributors: [],       approvals: 0, conflicts: 'latest', publish: { mode: 'interval', intervalMinutes: 10, pendingCommits: 20 }, signedApprovals: false },
}

export function defaultPolicy(owner: string, readers: Policy['readers'] = 'public', kind: NamespaceKind = readers === 'key' ? 'personal' : 'public'): Policy {
  return { owner, reviewers: [], readers, ...POLICY_DEFAULTS[kind] }
}

/** Older refs lack the W2–W4 fields; fill them from the kind implied by visibility. */
export function normalisePolicy(p: Partial<Policy> & { owner: string }): Policy {
  const kind: NamespaceKind = p.kind ?? (p.readers === 'key' ? 'personal' : 'public')
  const d = POLICY_DEFAULTS[kind]
  return {
    owner: p.owner, kind, reviewers: p.reviewers ?? [], readers: p.readers ?? 'public',
    contributors: p.contributors ?? d.contributors, approvals: p.approvals ?? d.approvals,
    conflicts: p.conflicts ?? d.conflicts, publish: p.publish ?? d.publish, signedApprovals: p.signedApprovals ?? d.signedApprovals,
  }
}

export function rolesOf(policy: Policy, identity: string): Role[] {
  const id = identity.toLowerCase()
  const roles: Role[] = ['reader']
  if (policy.contributors === 'anyone' || policy.contributors.some((c) => c.toLowerCase() === id)) roles.push('contributor')
  if (policy.reviewers.some((r) => r.toLowerCase() === id)) roles.push('reviewer', 'contributor')
  if (policy.owner.toLowerCase() === id) roles.push('owner', 'reviewer', 'contributor')
  return [...new Set(roles)]
}

export function can(policy: Policy, identity: string, action: Action): boolean {
  const r = rolesOf(policy, identity)
  switch (action) {
    case 'read': return true
    case 'propose': return r.includes('contributor')
    case 'review': case 'approve': case 'merge': case 'commit': return r.includes('reviewer')
    case 'admin': return r.includes('owner')
  }
}

// ---------------------------------------------------------------------------
// Proposals — the review workflow (PRD §10, §23)
// ---------------------------------------------------------------------------

export type ProposalStatus = 'draft' | 'proposed' | 'under-review' | 'approved' | 'committed' | 'rejected'

export type Review = {
  reviewer: string
  verdict: 'approve' | 'reject' | 'comment'
  comment?: string
  at: string
  /** Head of the proposal branch this verdict was given on. */
  commit?: string
  /** EIP-191 signature over `reviewMessage(...)` by the key that owns `reviewer` (PRD W5). */
  signature?: string
  /** Address recovered from the signature at review time. */
  signer?: string
  /** Set by `land` after checking the signer owns the reviewer's ENS name. */
  verified?: boolean
}

/** The exact text a reviewer signs. Deterministic, so anyone can re-verify. */
export function reviewMessage(namespace: string, proposalId: string, commit: string, reviewer: string, verdict: Review['verdict'], at: string): string {
  return `knowledge-review\nnamespace: ${namespace}\nproposal: ${proposalId}\ncommit: ${commit}\nreviewer: ${reviewer}\nverdict: ${verdict}\nat: ${at}`
}

/** What automated review found. Advisory: a human or the policy decides (PRD §24). */
export type Finding = {
  kind: 'duplicate' | 'contradiction' | 'supersession' | 'missing-sources' | 'low-confidence' | 'unsupported-change' | 'removal'
  /** Blocking findings stop auto-land; advisory ones are recorded. */
  blocking?: boolean
  /** Knowledge object the finding is about. */
  id: string
  message: string
  /** Related object in the base, when the finding compares two. */
  related?: string
  similarity?: number
}

export type Proposal = {
  id: string
  /** Sequential, human-friendly: #1, #2… */
  number: number
  title: string
  description?: string
  author: string
  /** Branch that carries the proposed commits. */
  branch: string
  /** Branch it proposes to change. */
  base: string
  /** Base head when proposed — what the automated review compared against. */
  baseCommit: string
  status: ProposalStatus
  reviews: Review[]
  findings: Finding[]
  createdAt: string
  updatedAt: string
  /** Set when committed. */
  mergedCommit?: string
}

// ---------------------------------------------------------------------------
// Canonical form and hashing
// ---------------------------------------------------------------------------

/** Deterministic JSON — sorted keys, no whitespace — so hashes are stable. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    )
  }
  return value
}

export function hashObject(value: unknown): string {
  return bytesToHex(sha256(new TextEncoder().encode(canonicalJson(value))))
}

/** Git-style short id for display. */
export const shortId = (id: string): string => id.slice(0, 7)

/** Encode/decode objects for storage. Plaintext; encryption is the adapter's job. */
export const encodeObject = (value: unknown): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(value))
export const decodeObject = <T>(bytes: Uint8Array): T =>
  JSON.parse(new TextDecoder().decode(bytes)) as T

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

export type NewKnowledge = {
  claim: string
  subject?: string | null
  type?: string
  topic?: string | null
  confidence?: number
  sources?: Source[]
  contributor: string
  reviewers?: string[]
  tags?: string[]
  supersedes?: string
  /** Supply to control the id; otherwise derived from claim + subject + topic. */
  id?: string
  now?: string
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * Build a knowledge object.
 *
 * The id is derived from claim, subject and topic — not from the contributor —
 * so two historians stating the same claim collapse onto one object and a diff
 * shows an update rather than a duplicate. Who said it is provenance, not identity.
 */
export function newKnowledge(input: NewKnowledge): Knowledge {
  const now = input.now ?? new Date().toISOString()
  const topic = input.topic ?? null
  const subject = input.subject ?? null
  const id = input.id ?? `k_${hashObject({ c: norm(input.claim), s: norm(subject), t: topic }).slice(0, 12)}`
  return {
    id,
    subject,
    claim: input.claim,
    type: input.type ?? 'fact',
    topic,
    confidence: input.confidence ?? 0.8,
    sources: input.sources ?? [],
    contributor: input.contributor,
    reviewers: input.reviewers ?? [],
    tags: input.tags ?? [],
    ...(input.supersedes ? { supersedes: input.supersedes } : {}),
    created_at: now,
  }
}

// ---------------------------------------------------------------------------
// Multi-source merge (PRD W3)
// ---------------------------------------------------------------------------

/** Two sources are the same evidence when they share a name (or type) and id. */
export function sameSource(a: Source, b: Source): boolean {
  const key = (s: Source) => `${(s.name ?? s.type).toLowerCase()}|${(s.id ?? s.title ?? '').toLowerCase()}`
  return key(a) === key(b)
}

/** Distinct sources by name/type + id. */
export function distinctSources(sources: Source[]): Source[] {
  const out: Source[] = []
  for (const s of sources) if (!out.some((o) => sameSource(o, s))) out.push(s)
  return out
}

/**
 * Confidence from independent evidence: the chance that not every source is
 * wrong, capped so nothing is ever certain. Two 0.8 sources → 0.96.
 * Stated explicitly here because the PRD asked for the function, not a feeling.
 */
export function combineConfidence(values: number[], cap = 0.99): number {
  if (!values.length) return 0
  const p = 1 - values.reduce((acc, c) => acc * (1 - Math.min(Math.max(c, 0), 1)), 1)
  return Math.min(Math.round(p * 1000) / 1000, cap)
}

/**
 * Merge an incoming statement of a claim that already exists (same id: same
 * claim, subject and topic). New sources are appended; confidence rises with
 * each independent source; the first contributor keeps the attribution and
 * later ones appear on their sources. Nothing is duplicated.
 */
export function mergeClaim(existing: Knowledge, incoming: Knowledge): { merged: Knowledge; newSources: number } {
  const before = distinctSources(existing.sources)
  const all = distinctSources([...existing.sources, ...incoming.sources])
  const newSources = all.length - before.length
  const confidence = newSources > 0
    ? combineConfidence([existing.confidence, incoming.confidence])
    : Math.max(existing.confidence, incoming.confidence)
  const sameTags = new Set([...existing.tags, ...incoming.tags]).size === existing.tags.length
  // Re-stating something already known is not a change. Without this, an agent
  // on a timer would bump `updated_at` on every pass and commit an empty version
  // each time — busy history, no new knowledge.
  const unchanged = newSources === 0 && confidence === existing.confidence && sameTags && (!incoming.supersedes || existing.supersedes === incoming.supersedes)
  if (unchanged) return { merged: existing, newSources: 0 }
  const merged: Knowledge = {
    ...existing,
    sources: all,
    confidence,
    tags: [...new Set([...existing.tags, ...incoming.tags])],
    ...(incoming.supersedes && !existing.supersedes ? { supersedes: incoming.supersedes } : {}),
    updated_at: incoming.updated_at ?? incoming.created_at,
  }
  return { merged, newSources }
}

/** Same claim in the sense that matters for merging: same statement, subject and topic (ids alone are not enough — both sides of a merge share the id). */
export function sameClaim(a: Knowledge, b: Knowledge): boolean {
  return norm(a.claim) === norm(b.claim) && norm(a.subject) === norm(b.subject) && (a.topic ?? null) === (b.topic ?? null)
}

/** Compute what changed between two snapshots, by id. */
export function changesBetween(before: Snapshot, after: Snapshot): Changes {
  const added: string[] = []
  const updated: string[] = []
  const removed: string[] = []
  for (const id of Object.keys(after)) {
    if (!(id in before)) added.push(id)
    else if (canonicalJson(before[id]) !== canonicalJson(after[id])) updated.push(id)
  }
  for (const id of Object.keys(before)) if (!(id in after)) removed.push(id)
  return { added: added.sort(), updated: updated.sort(), removed: removed.sort() }
}

export type NewCommit = {
  parents: Commit[]
  branch: string
  author: string
  message: string
  snapshot: Snapshot
  proposal?: string
  now?: string
}

/**
 * Create a commit. Changes are computed against the first parent — for a merge
 * commit that is "ours", the same convention git uses.
 */
export function createCommit(input: NewCommit): Commit {
  const base: Snapshot = input.parents[0]?.snapshot ?? {}
  const body: Omit<Commit, 'id'> = {
    kind: 'commit',
    parents: input.parents.map((p) => p.id),
    branch: input.branch,
    author: input.author,
    timestamp: input.now ?? new Date().toISOString(),
    message: input.message,
    changes: changesBetween(base, input.snapshot),
    snapshot: input.snapshot,
    ...(input.proposal ? { proposal: input.proposal } : {}),
  }
  return { ...body, id: hashObject(body) }
}

/** Recompute a commit's id and check it matches — detects tampering in transit. */
export function verifyCommit(commit: Commit): boolean {
  const { id, ...body } = commit
  return hashObject(body) === id
}

export function emptyRefs(namespace: string, owner: string, opts: { head?: string; readers?: Policy['readers']; kind?: NamespaceKind; title?: string; description?: string; parent?: string } = {}): Refs {
  return {
    kind: 'refs',
    namespace,
    head: opts.head ?? 'main',
    branches: {},
    objects: {},
    policy: defaultPolicy(owner, opts.readers ?? 'public', opts.kind),
    proposals: {},
    ...(opts.title ? { title: opts.title } : {}),
    ...(opts.description ? { description: opts.description } : {}),
    ...(opts.parent ? { parent: opts.parent } : {}),
    children: [],
    sources: {},
    findings: {},
    outbox: {},
    updatedAt: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export class KnowledgeValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid knowledge object:\n  - ${issues.join('\n  - ')}`)
    this.name = 'KnowledgeValidationError'
  }
}

const BRANCH = /^[a-z0-9][a-z0-9._\/-]{0,63}$/

export function isValidBranchName(name: string): boolean {
  return BRANCH.test(name) && !name.includes('..') && !name.endsWith('/')
}

export function validateKnowledge(m: unknown, path = 'knowledge'): asserts m is Knowledge {
  const issues: string[] = []
  if (typeof m !== 'object' || m === null) throw new KnowledgeValidationError([`${path} is not an object`])
  const x = m as Record<string, unknown>
  if (typeof x.id !== 'string' || !x.id) issues.push(`${path}.id required`)
  if (typeof x.claim !== 'string' || !x.claim.trim()) issues.push(`${path}.claim required`)
  if (x.subject !== null && typeof x.subject !== 'string') issues.push(`${path}.subject must be a string or null`)
  if (typeof x.type !== 'string') issues.push(`${path}.type must be a string`)
  if (x.topic !== null && typeof x.topic !== 'string') issues.push(`${path}.topic must be a string or null`)
  if (typeof x.confidence !== 'number' || x.confidence < 0 || x.confidence > 1) issues.push(`${path}.confidence must be 0..1`)
  if (!Array.isArray(x.sources) || !x.sources.every((s) => typeof s === 'object' && s !== null && typeof (s as Source).type === 'string'))
    issues.push(`${path}.sources must be Source[]`)
  if (typeof x.contributor !== 'string' || !x.contributor) issues.push(`${path}.contributor required`)
  if (!Array.isArray(x.reviewers) || !x.reviewers.every((t) => typeof t === 'string')) issues.push(`${path}.reviewers must be string[]`)
  if (x.supersedes !== undefined && typeof x.supersedes !== 'string') issues.push(`${path}.supersedes must be a string`)
  if (typeof x.created_at !== 'string') issues.push(`${path}.created_at required`)
  if (!Array.isArray(x.tags) || !x.tags.every((t) => typeof t === 'string')) issues.push(`${path}.tags must be string[]`)
  if (issues.length) throw new KnowledgeValidationError(issues)
}

export function validateCommit(c: unknown): asserts c is Commit {
  const issues: string[] = []
  if (typeof c !== 'object' || c === null) throw new KnowledgeValidationError(['commit is not an object'])
  const x = c as Record<string, unknown>
  if (x.kind !== 'commit') issues.push('kind must be "commit"')
  if (typeof x.id !== 'string' || x.id.length !== 64) issues.push('id must be a sha256 hex')
  if (!Array.isArray(x.parents)) issues.push('parents must be an array')
  if (typeof x.branch !== 'string' || !isValidBranchName(x.branch)) issues.push('branch invalid')
  if (typeof x.author !== 'string') issues.push('author required')
  if (typeof x.timestamp !== 'string') issues.push('timestamp required')
  if (typeof x.message !== 'string') issues.push('message required')
  if (typeof x.snapshot !== 'object' || x.snapshot === null) issues.push('snapshot required')
  else for (const [id, m] of Object.entries(x.snapshot as Snapshot)) {
    try { validateKnowledge(m, `snapshot.${id}`) } catch (e) { issues.push(...(e as KnowledgeValidationError).issues) }
    if ((m as Knowledge).id !== id) issues.push(`snapshot.${id}: key does not match knowledge.id`)
  }
  if (issues.length) throw new KnowledgeValidationError(issues)
  if (!verifyCommit(c as Commit)) throw new KnowledgeValidationError(['commit id does not match its content'])
}
