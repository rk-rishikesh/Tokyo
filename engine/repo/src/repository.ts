/**
 * The operations a person or agent performs on a knowledge namespace.
 *
 * Porcelain over `RepoStore`: add, observe, commit, branch, checkout, merge,
 * revert, log, diff, why — and the review workflow: propose, review, approve,
 * reject, land. Everything here is local and free. Nothing touches ENS or IPFS
 * until `push` in remote.ts.
 *
 * Roles (PRD §9, §25) are enforced here against `identity` — who this
 * repository acts as. The on-chain guarantee is narrower and stronger: only the
 * namespace owner's wallet can move the pointer. Everything else is protocol.
 */
import {
  blockingFindings, can, createCommit, diffSnapshots, hashObject, isValidBranchName, log, mergeBase, mergeClaim, newKnowledge, proposeMemory,
  reviewChanges, reviewMessage, revertCommit, rolesOf, shortId, threeWayMerge, validateCommit, verifyCommit, why,
  type Action, type Commit, type Finding, type Knowledge, type MergeResult, type NewKnowledge, type ObserveOptions,
  type Observation, type Policy, type Proposal, type ProposalBundle, type Provenance, type Refs, type Resolution, type Review, type Role,
  type Snapshot, type SnapshotDiff, type SourceConnection, type SourceKind,
} from '@recall/core'
import { RepoStore, repoPath, type InitOptions } from './store.js'

export type Status = {
  namespace: string
  branch: string
  head: Commit | undefined
  /** Uncommitted changes in the index relative to HEAD. */
  staged: SnapshotDiff
  branches: Record<string, string>
  unpushed: number
  version: number
  roles: Role[]
  openProposals: number
  publish: { due: boolean; pending: number; reason: string; last?: { at: string; version: number } }
  unresolvedFindings: number
}

export class Repository {
  /** Act as another identity for this process only (CLI `--as`, MCP KNOWLEDGE_AGENT). Never written to disk. */
  actingAs?: string

  constructor(readonly store: RepoStore) {}

  static open(namespace: string): Repository {
    return new Repository(RepoStore.open(repoPath(namespace)))
  }

  static init(namespace: string, identity: string, opts: { defaultBranch?: string; contentKey?: string } & InitOptions = {}): Repository {
    const readers = opts.readers ?? (opts.contentKey ? 'key' : 'public')
    const kind = opts.kind ?? (readers === 'key' ? 'personal' : 'public')
    const store = RepoStore.init(repoPath(namespace), {
      namespace,
      identity,
      defaultBranch: opts.defaultBranch ?? 'main',
      ...(opts.contentKey ? { contentKey: opts.contentKey } : {}),
    }, { readers, kind, ...(opts.title ? { title: opts.title } : {}), ...(opts.description ? { description: opts.description } : {}), ...(opts.parent ? { parent: opts.parent } : {}) })
    return new Repository(store)
  }

  // ---- state ----

  get namespace(): string { return this.store.readConfig().namespace }
  get identity(): string { return this.actingAs ?? this.store.readConfig().identity }
  get branch(): string { return this.store.readHead() }
  get refs(): Refs { return this.store.readRefs() }
  get policy(): Policy { return this.refs.policy }
  roles(identity = this.identity): Role[] { return rolesOf(this.policy, identity) }

  headCommit(branch = this.branch): Commit | undefined {
    const id = this.store.readRefs().branches[branch]
    return id ? this.store.getCommit(id) : undefined
  }

  /** The committed snapshot at HEAD, or empty on a fresh branch. */
  headSnapshot(branch = this.branch): Snapshot {
    return this.headCommit(branch)?.snapshot ?? {}
  }

  /** The working snapshot — what the next commit would contain. */
  index(): Snapshot { return this.store.readIndex() }

  /** Version number of a branch: commits on its first-parent line. `main` at v42 has 42 commits. */
  version(branch = this.branch): number {
    const head = this.store.readRefs().branches[branch]
    return head ? log(this.store.getCommit, head, 100_000).length : 0
  }

  status(): Status {
    const refs = this.store.readRefs()
    const head = this.headCommit()
    return {
      namespace: this.namespace,
      branch: this.branch,
      head,
      staged: diffSnapshots(head?.snapshot ?? {}, this.index()),
      branches: refs.branches,
      unpushed: this.store.allCommitIds().filter((id) => !(id in refs.objects)).length,
      version: this.version(),
      roles: this.roles(),
      openProposals: Object.values(refs.proposals).filter((p) => !['committed', 'rejected'].includes(p.status)).length,
      publish: { ...this.publishDue(), ...(this.store.readConfig().publish?.lastPublish ? { last: { at: this.store.readConfig().publish!.lastPublish!.at, version: this.store.readConfig().publish!.lastPublish!.version } } : {}) },
      unresolvedFindings: Object.keys(refs.findings).length,
    }
  }

  // ---- knowledge ----

  /**
   * Stage a knowledge object. The same claim about the same subject in the same
   * topic merges (PRD W3): sources append, confidence rises with independent
   * evidence, the first contributor keeps the attribution. A claim that
   * `supersedes` another retires the old one from the snapshot; history keeps it.
   */
  add(input: Omit<NewKnowledge, 'contributor'> & { contributor?: string }): Knowledge {
    const index = this.index()
    const k = newKnowledge({ ...input, contributor: input.contributor ?? this.identity })
    const existing = index[k.id]
    const next: Knowledge = existing ? mergeClaim(existing, k).merged : k
    index[k.id] = next
    if (k.supersedes && k.supersedes !== k.id && index[k.supersedes]) delete index[k.supersedes]
    this.store.writeIndex(index)
    return next
  }

  /** Change fields on an existing object in the index. */
  update(id: string, patch: Partial<Pick<Knowledge, 'claim' | 'subject' | 'type' | 'topic' | 'confidence' | 'tags' | 'sources'>>): Knowledge {
    const index = this.index()
    const cur = index[id]
    if (!cur) throw new Error(`no knowledge ${id} in the working snapshot`)
    const next: Knowledge = { ...cur, ...patch, updated_at: new Date().toISOString() }
    index[id] = next
    this.store.writeIndex(index)
    return next
  }

  /** Remove an object from the index. It stays in history; that is the point. */
  remove(id: string): boolean {
    const index = this.index()
    if (!(id in index)) return false
    delete index[id]
    this.store.writeIndex(index)
    return true
  }

  /** add + commit in one step: the personal-memory shape of a contribution. */
  remember(input: Omit<NewKnowledge, 'contributor'> & { contributor?: string; message?: string }): { knowledge: Knowledge; commit: Commit } {
    this.requireCommitHere()
    const knowledge = this.add(input)
    const commit = this.commit(input.message ?? `add: ${knowledge.claim.slice(0, 60)}`, { author: input.contributor ?? this.identity })
    return { knowledge, commit }
  }

  /**
   * Observation → proposal → (maybe) commit. An app reports what it saw; the
   * engine decides whether that is new, already known, a supersession or a
   * conflict, and commits only what clears the bar.
   */
  observe(
    input: Omit<NewKnowledge, 'contributor'> & { contributor?: string },
    opts: ObserveOptions & { commit?: boolean; message?: string } = {},
  ): { proposal: Observation; commit?: Commit } {
    if (opts.commit !== false) this.requireCommitHere()
    const index = this.index()
    let proposal = proposeMemory(index, { ...input, contributor: input.contributor ?? this.identity }, opts)
    // Unmarked conflict: the namespace policy decides (PRD W3). "ask" leaves it for a person.
    if (proposal.action === 'conflict' && proposal.existing && this.policy.conflicts !== 'ask') {
      const win = this.policy.conflicts === 'latest' || proposal.knowledge.confidence >= proposal.existing.confidence
      if (win) proposal = { ...proposal, action: 'update', knowledge: { ...proposal.existing, claim: proposal.knowledge.claim, confidence: proposal.knowledge.confidence, sources: proposal.knowledge.sources, updated_at: proposal.knowledge.created_at }, reason: `${proposal.reason} Resolved by policy "${this.policy.conflicts}": the new statement wins; the old one stays in history.` }
    }
    const apply = proposal.action === 'add' || proposal.action === 'update'
      || (proposal.action === 'known' && proposal.existing && proposal.knowledge.confidence > proposal.existing.confidence)
    if (!apply) return { proposal }
    index[proposal.knowledge.id] = proposal.knowledge
    this.store.writeIndex(index)
    if (opts.commit === false) return { proposal }
    const verb = proposal.action === 'add' ? 'observe' : proposal.action === 'update' ? 'revise' : 'reinforce'
    const commit = this.commit(opts.message ?? `${verb}: ${proposal.knowledge.claim.slice(0, 60)}`, { author: input.contributor ?? this.identity })
    return { proposal, commit }
  }

  // ---- commits ----

  /**
   * Whether the index differs from the current branch head — i.e. whether
   * `commit` would have anything to write. Callers on a timer use this to tell
   * "nothing changed" apart from a genuine failure.
   */
  hasChanges(): boolean {
    const parent = this.headCommit(this.branch)
    return diffSnapshots(parent?.snapshot ?? {}, this.index()).changes.length > 0
  }

  /**
   * Commit the index to the current branch. Committing straight to the default
   * branch is a reviewer/owner action; contributors commit on their own branch
   * and `propose`.
   */
  commit(message: string, opts: { author?: string; allowEmpty?: boolean; proposal?: string } = {}): Commit {
    const branch = this.branch
    const refs = this.store.readRefs()
    if (branch === refs.head) this.require('commit', `commit directly to ${branch}`)
    const parent = this.headCommit(branch)
    const snapshot = this.index()
    const diff = diffSnapshots(parent?.snapshot ?? {}, snapshot)
    if (!diff.changes.length && !opts.allowEmpty) throw new Error('nothing to commit')
    const c = createCommit({
      parents: parent ? [parent] : [],
      branch,
      author: opts.author ?? this.identity,
      message,
      snapshot,
      ...(opts.proposal ? { proposal: opts.proposal } : {}),
    })
    this.store.putCommit(c)
    this.moveBranch(branch, c.id)
    // Nothing gated this write. Detect anyway and queue it for the owner (PRD W2).
    if (branch === refs.head && !opts.proposal) {
      const findings = reviewChanges(parent?.snapshot ?? {}, snapshot)
      if (findings.length) { const r = this.store.readRefs(); r.findings[c.id] = findings; this.store.writeRefs(r) }
    }
    return c
  }

  // ---- findings queue (PRD W2) ----

  /** Findings recorded on ungated commits, newest commit first. */
  findings(): { commit: Commit; findings: Finding[] }[] {
    const refs = this.store.readRefs()
    return Object.entries(refs.findings).map(([id, findings]) => ({ commit: this.store.getCommit(id)!, findings })).filter((x) => x.commit).sort((a, b) => b.commit.timestamp.localeCompare(a.commit.timestamp))
  }

  resolveFindings(commitId: string): void {
    const refs = this.store.readRefs()
    const c = this.resolve(commitId)
    delete refs.findings[c.id]
    this.store.writeRefs(refs)
  }

  /**
   * Settle one finding on a commit, leaving the others. A commit that added
   * three claims can raise three questions, and answering one must not
   * silently answer the rest.
   */
  resolveFinding(commitId: string, index: number): void {
    const refs = this.store.readRefs()
    const c = this.resolve(commitId)
    const list = refs.findings[c.id]
    if (!list || !list[index]) return
    list.splice(index, 1)
    if (list.length) refs.findings[c.id] = list
    else delete refs.findings[c.id]
    this.store.writeRefs(refs)
  }

  log(branch = this.branch, limit = 50): Commit[] {
    const head = this.store.readRefs().branches[branch]
    return head ? log(this.store.getCommit, head, limit) : []
  }

  /** Resolve a branch name, HEAD, vN, or (short) commit id to a commit. */
  resolve(ref: string): Commit {
    const refs = this.store.readRefs()
    const byBranch = refs.branches[ref]
    if (byBranch) return this.store.getCommit(byBranch)!
    if (ref === 'HEAD') return this.headCommit() ?? this.fail(`branch ${this.branch} has no commits`)
    const v = /^v(\d+)$/.exec(ref)
    if (v) {
      const line = this.log(refs.head, 100_000)
      const c = line[line.length - Number(v[1])]
      return c ?? this.fail(`no version ${ref} on ${refs.head}`)
    }
    const exact = this.store.getCommit(ref)
    if (exact) return exact
    const matches = this.store.allCommitIds().filter((id) => id.startsWith(ref))
    if (matches.length === 1) return this.store.getCommit(matches[0]!)!
    if (matches.length > 1) this.fail(`ambiguous ref ${ref}`)
    return this.fail(`unknown ref ${ref}`)
  }

  diff(a: string, b: string): SnapshotDiff {
    return diffSnapshots(this.resolve(a).snapshot, this.resolve(b).snapshot)
  }

  why(knowledgeId: string, branch = this.branch): Provenance | undefined {
    const head = this.store.readRefs().branches[branch]
    return head ? why(this.store.getCommit, head, knowledgeId) : undefined
  }

  // ---- branches ----

  branches(): Record<string, string> { return this.store.readRefs().branches }

  createBranch(name: string, from = this.branch): void {
    if (!isValidBranchName(name)) throw new Error(`invalid branch name "${name}"`)
    const refs = this.store.readRefs()
    if (name in refs.branches) throw new Error(`branch ${name} already exists`)
    const at = refs.branches[from]
    if (!at) throw new Error(`branch ${from} has no commits yet — commit first, then branch`)
    refs.branches[name] = at
    this.store.writeRefs(refs)
  }

  deleteBranch(name: string): void {
    const refs = this.store.readRefs()
    if (name === this.branch) throw new Error('cannot delete the current branch')
    if (name === refs.head) throw new Error('cannot delete the default branch')
    delete refs.branches[name]
    this.store.writeRefs(refs)
  }

  checkout(name: string, opts: { create?: boolean } = {}): void {
    const refs = this.store.readRefs()
    if (!(name in refs.branches)) {
      if (!opts.create) throw new Error(`no branch ${name}`)
      this.createBranch(name)
    }
    if (this.status().staged.changes.length) {
      throw new Error('uncommitted changes in the working snapshot — commit or discard them first')
    }
    this.store.writeHead(name)
    this.store.writeIndex(this.headSnapshot(name))
  }

  private moveBranch(branch: string, commitId: string): void {
    const refs = this.store.readRefs()
    refs.branches[branch] = commitId
    refs.updatedAt = new Date().toISOString()
    this.store.writeRefs(refs)
  }

  // ---- merge / revert ----

  merge(other: string, opts: { resolutions?: Resolution; message?: string; proposal?: string; reviewers?: string[] } = {}): { commit?: Commit; result: MergeResult; fastForward: boolean } {
    const refs = this.store.readRefs()
    if (this.branch === refs.head) this.require('merge', `merge into ${this.branch}`)
    const ours = this.headCommit()
    const theirs = this.resolve(other)
    const stamp = (snap: Snapshot): Snapshot => {
      if (!opts.reviewers?.length) return snap
      const out: Snapshot = {}
      const before = ours?.snapshot ?? {}
      for (const [id, k] of Object.entries(snap)) {
        const changed = !before[id] || JSON.stringify(before[id]) !== JSON.stringify(k)
        out[id] = changed ? { ...k, reviewers: [...new Set([...k.reviewers, ...opts.reviewers])] } : k
      }
      return out
    }
    const land = (snapshot: Snapshot, parents: Commit[], message: string, tookTheirs: string[], fastForward: boolean) => {
      const c = createCommit({ parents, branch: this.branch, author: this.identity, message, snapshot, ...(opts.proposal ? { proposal: opts.proposal } : {}) })
      this.store.putCommit(c)
      this.moveBranch(this.branch, c.id)
      this.store.writeIndex(c.snapshot)
      return { commit: c, result: { snapshot: c.snapshot, conflicts: [], tookTheirs }, fastForward }
    }

    if (!ours) {
      if (opts.reviewers?.length || opts.proposal) return land(stamp(theirs.snapshot), [theirs], opts.message ?? `merge ${other} into ${this.branch}`, Object.keys(theirs.snapshot), false)
      this.moveBranch(this.branch, theirs.id)
      this.store.writeIndex(theirs.snapshot)
      return { commit: theirs, result: { snapshot: theirs.snapshot, conflicts: [], tookTheirs: Object.keys(theirs.snapshot) }, fastForward: true }
    }
    if (ours.id === theirs.id) return { result: { snapshot: ours.snapshot, conflicts: [], tookTheirs: [] }, fastForward: true }

    const base = mergeBase(this.store.getCommit, ours.id, theirs.id)
    if (base === ours.id) {
      // Behind: fast-forward — unless review stamps must be recorded, which needs a commit.
      if (opts.reviewers?.length || opts.proposal) return land(stamp(theirs.snapshot), [ours, theirs], opts.message ?? `merge ${other} into ${this.branch}`, Object.keys(diffSnapshots(ours.snapshot, theirs.snapshot).changes), false)
      this.moveBranch(this.branch, theirs.id)
      this.store.writeIndex(theirs.snapshot)
      return { commit: theirs, result: { snapshot: theirs.snapshot, conflicts: [], tookTheirs: [] }, fastForward: true }
    }
    if (base === theirs.id) return { result: { snapshot: ours.snapshot, conflicts: [], tookTheirs: [] }, fastForward: true }

    const baseSnap = base ? this.store.getCommit(base)!.snapshot : {}
    const result = threeWayMerge(baseSnap, ours.snapshot, theirs.snapshot, opts.resolutions)
    if (result.conflicts.length) return { result, fastForward: false }
    return land(stamp(result.snapshot), [ours, theirs], opts.message ?? `merge ${other} into ${this.branch}`, result.tookTheirs, false)
  }

  revert(ref: string): { commit?: Commit; conflicts: { id: string; reason: string }[] } {
    const target = this.resolve(ref)
    const parent = target.parents[0] ? this.store.getCommit(target.parents[0])!.snapshot : {}
    const r = revertCommit(target, parent, this.index())
    if (r.conflicts.length) return { conflicts: r.conflicts }
    this.store.writeIndex(r.snapshot)
    const c = this.commit(`Revert ${shortId(target.id)}: ${target.message}`)
    return { commit: c, conflicts: [] }
  }

  // ---- review workflow (PRD §10, §23) ----

  proposals(): Proposal[] {
    return Object.values(this.store.readRefs().proposals).sort((a, b) => a.number - b.number)
  }

  proposal(ref: string | number): Proposal {
    const all = this.proposals()
    const p = typeof ref === 'number' || /^#?\d+$/.test(String(ref))
      ? all.find((x) => x.number === Number(String(ref).replace('#', '')))
      : all.find((x) => x.id === ref || x.branch === ref)
    return p ?? this.fail(`no proposal ${ref}`)
  }

  /**
   * Propose the current branch (or `branch`) for review against the default
   * branch. Runs the automated review and records its findings.
   */
  propose(meta: { title: string; description?: string; branch?: string; base?: string }): Proposal {
    this.require('propose', 'propose a contribution')
    const refs = this.store.readRefs()
    const branch = meta.branch ?? this.branch
    const base = meta.base ?? refs.head
    if (branch === base) throw new Error(`cannot propose ${branch} onto itself — create a branch for the contribution first`)
    const head = refs.branches[branch]
    if (!head) throw new Error(`branch ${branch} has no commits`)
    if (Object.values(refs.proposals).some((p) => p.branch === branch && !['committed', 'rejected'].includes(p.status))) {
      throw new Error(`branch ${branch} already has an open proposal`)
    }
    const baseCommit = refs.branches[base] ?? ''
    const now = new Date().toISOString()
    const number = Math.max(0, ...Object.values(refs.proposals).map((p) => p.number)) + 1
    const findings = this.findingsFor(branch, base)
    const p: Proposal = {
      id: `p_${hashObject({ n: refs.namespace, b: branch, h: head, t: now }).slice(0, 12)}`,
      number, title: meta.title, ...(meta.description ? { description: meta.description } : {}),
      author: this.identity, branch, base, baseCommit,
      status: findings.length ? 'under-review' : 'proposed',
      reviews: [], findings, createdAt: now, updatedAt: now,
    }
    refs.proposals[p.id] = p
    this.store.writeRefs(refs)
    // approvals: 0 — review is a policy, not a tax (PRD W2). Land unless a finding blocks;
    // under a "latest"/"confidence" conflict policy, contradictions do not block either.
    if (refs.policy.approvals === 0) {
      const blocking = blockingFindings(findings).filter((f) => !(f.kind === 'contradiction' && refs.policy.conflicts !== 'ask'))
      if (!blocking.length) {
        const r2 = this.store.readRefs(); r2.proposals[p.id] = { ...p, status: 'approved' }; this.store.writeRefs(r2)
        const landed = this.land(p.id)
        if (landed.commit && findings.length) { const r3 = this.store.readRefs(); r3.findings[landed.commit.id] = findings; this.store.writeRefs(r3) }
        return landed.proposal
      }
    }
    return p
  }

  /** What the proposal would change on its base, and what the automated review says about it. */
  findingsFor(branch: string, base: string): Finding[] {
    const ours = this.headSnapshot(base)
    const theirs = this.headSnapshot(branch)
    const b = this.store.readRefs().branches[base]; const t = this.store.readRefs().branches[branch]
    const mb = b && t ? mergeBase(this.store.getCommit, b, t) : undefined
    const baseSnap = mb ? this.store.getCommit(mb)!.snapshot : {}
    // Compare what the branch changed since it diverged against the current base.
    const merged = threeWayMerge(baseSnap, ours, theirs).snapshot
    return reviewChanges(ours, merged)
  }

  proposalDiff(ref: string | number): SnapshotDiff {
    const p = this.proposal(ref)
    return diffSnapshots(this.headSnapshot(p.base), this.headSnapshot(p.branch))
  }

  /** The text a reviewer signs for this verdict (PRD W5). */
  reviewText(ref: string | number, verdict: Review['verdict'], at: string): { message: string; commit: string } {
    const p = this.proposal(ref)
    const commit = this.store.readRefs().branches[p.branch] ?? ''
    return { message: reviewMessage(this.namespace, p.id, commit, this.identity, verdict, at), commit }
  }

  /**
   * Record a review. Approvals count toward the policy's threshold; a reject
   * closes the proposal. A signature (EIP-191 over `reviewText`) makes the
   * approval verifiable at `land`; without one it is a claim by this repository.
   */
  review(ref: string | number, verdict: Review['verdict'], comment?: string, signed?: { at: string; signature: string; signer: string }): Proposal {
    this.require('review', 'review a contribution')
    const refs = this.store.readRefs()
    const p = this.proposal(ref)
    if (['committed', 'rejected'].includes(p.status)) throw new Error(`proposal #${p.number} is ${p.status}`)
    if (verdict === 'approve' && p.author.toLowerCase() === this.identity.toLowerCase() && !this.roles().includes('owner')) {
      throw new Error('a contributor cannot approve their own proposal')
    }
    const now = signed?.at ?? new Date().toISOString()
    const commit = refs.branches[p.branch] ?? ''
    const review: Review = { reviewer: this.identity, verdict, ...(comment ? { comment } : {}), at: now, commit, ...(signed ? { signature: signed.signature, signer: signed.signer } : {}) }
    p.reviews = [...p.reviews.filter((r) => !(r.reviewer === this.identity && r.verdict !== 'comment')), review]
    p.findings = this.findingsFor(p.branch, p.base)
    const approvals = new Set(p.reviews.filter((r) => r.verdict === 'approve').map((r) => r.reviewer)).size
    p.status = verdict === 'reject' ? 'rejected' : approvals >= refs.policy.approvals ? 'approved' : 'under-review'
    p.updatedAt = now
    refs.proposals[p.id] = p
    this.store.writeRefs(refs)
    return p
  }

  /**
   * Land an approved proposal on its base: merge, stamp reviewers on every
   * changed object, close the proposal. The commit records the proposal id.
   */
  /**
   * Check every approval's signature against the reviewer's ENS owner (PRD W5).
   * `ownerOf` resolves a name to the address that owns it — on chain in
   * production, a table in tests. Returns the reviews with `verified` set.
   */
  async verifyApprovals(ref: string | number, ownerOf: (name: string) => Promise<string | null>, recover: (message: string, signature: string) => Promise<string>): Promise<Review[]> {
    const p = this.proposal(ref)
    const out: Review[] = []
    for (const r of p.reviews) {
      if (r.verdict !== 'approve') { out.push(r); continue }
      let verified = false
      if (r.signature && r.commit) {
        try {
          const signer = await recover(reviewMessage(this.namespace, p.id, r.commit, r.reviewer, r.verdict, r.at), r.signature)
          const owner = await ownerOf(r.reviewer)
          verified = !!owner && owner.toLowerCase() === signer.toLowerCase()
        } catch { verified = false }
      }
      out.push({ ...r, verified })
    }
    const refs = this.store.readRefs()
    refs.proposals[p.id] = { ...p, reviews: out, updatedAt: new Date().toISOString() }
    this.store.writeRefs(refs)
    return out
  }

  land(ref: string | number, opts: { resolutions?: Resolution } = {}): { proposal: Proposal; commit?: Commit; result: MergeResult } {
    this.require('merge', 'land a contribution')
    const p = this.proposal(ref)
    if (p.status !== 'approved') throw new Error(`proposal #${p.number} is ${p.status}; it needs ${this.policy.approvals} approval(s) first`)
    if (this.policy.signedApprovals && this.policy.approvals > 0) {
      const unverified = p.reviews.filter((r) => r.verdict === 'approve' && !r.verified)
      if (unverified.length) throw new Error(`this namespace requires signed approvals; unverified: ${unverified.map((r) => r.reviewer).join(', ')} — run verifyApprovals (knowledge land verifies on chain) or have the reviewer sign`)
    }
    const reviewers = [...new Set(p.reviews.filter((r) => r.verdict === 'approve').map((r) => r.reviewer))]
    const prev = this.branch
    if (prev !== p.base) this.checkout(p.base)
    const r = this.merge(p.branch, { ...(opts.resolutions ? { resolutions: opts.resolutions } : {}), message: `#${p.number} ${p.title}`, proposal: p.id, reviewers })
    if (r.result.conflicts.length) { if (prev !== p.base) this.checkout(prev); return { proposal: p, result: r.result } }
    const refs = this.store.readRefs()
    const done: Proposal = { ...p, status: 'committed', mergedCommit: r.commit!.id, updatedAt: new Date().toISOString() }
    refs.proposals[p.id] = done
    this.store.writeRefs(refs)
    return { proposal: done, commit: r.commit, result: r.result }
  }

  // ---- fork-and-pull (PRD W5) ----

  /** Package a proposal with every commit its branch carries, for another repository to ingest. */
  exportProposal(ref: string | number): ProposalBundle {
    const p = this.proposal(ref)
    const head = this.store.readRefs().branches[p.branch]
    if (!head) throw new Error(`branch ${p.branch} has no commits`)
    const baseIds = new Set(this.store.readRefs().branches[p.base] ? [...ancestorsOf(this.store.getCommit, this.store.readRefs().branches[p.base]!)] : [])
    const commits = [...ancestorsOf(this.store.getCommit, head)].filter((id) => !baseIds.has(id)).map((id) => this.store.getCommit(id)!).sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    return { kind: 'proposal-bundle', target: this.namespace, proposal: p, commits, from: this.identity, createdAt: new Date().toISOString() }
  }

  /**
   * Ingest a bundle from a contributor's fork: verify every commit, recreate the
   * branch, and open the proposal in this repository's review queue under the
   * contributor's name. The owner never needs to trust the contributor's machine.
   */
  importProposal(bundle: ProposalBundle): Proposal {
    if (bundle.kind !== 'proposal-bundle') throw new Error('not a proposal bundle')
    if (bundle.target !== this.namespace) throw new Error(`bundle targets ${bundle.target}, this is ${this.namespace}`)
    for (const c of bundle.commits) { validateCommit(c); if (!verifyCommit(c)) throw new Error(`commit ${shortId(c.id)} fails verification`); this.store.putCommit(c) }
    const refs = this.store.readRefs()
    const head = bundle.commits[bundle.commits.length - 1]?.id ?? refs.branches[bundle.proposal.branch]
    if (!head) throw new Error('bundle carries no commits')
    let branch = bundle.proposal.branch
    if (refs.branches[branch] && refs.branches[branch] !== head) branch = `${branch}-${shortId(head)}`
    refs.branches[branch] = head
    const number = Math.max(0, ...Object.values(refs.proposals).map((x) => x.number)) + 1
    const now = new Date().toISOString()
    const p: Proposal = { ...bundle.proposal, number, branch, base: refs.head, baseCommit: refs.branches[refs.head] ?? '', author: bundle.proposal.author || bundle.from, reviews: [], status: 'proposed', mergedCommit: undefined, createdAt: now, updatedAt: now }
    delete (p as { mergedCommit?: string }).mergedCommit
    refs.proposals[p.id] = p
    this.store.writeRefs(refs)
    const findings = this.findingsFor(branch, refs.head)
    const r2 = this.store.readRefs(); r2.proposals[p.id] = { ...p, findings, status: findings.length ? 'under-review' : 'proposed' }; this.store.writeRefs(r2)
    return r2.proposals[p.id]!
  }

  // ---- publish state (PRD W4) ----

  /** Is a publish due under the namespace's publish policy? */
  publishDue(now = Date.now()): { due: boolean; pending: number; reason: string } {
    const refs = this.store.readRefs()
    const pendingIds = this.store.allCommitIds().filter((id) => !(id in refs.objects))
    const pending = pendingIds.length
    const pol = refs.policy.publish
    if (!pending) return { due: false, pending, reason: 'nothing to publish' }
    if (pol.mode === 'manual') return { due: false, pending, reason: 'manual publish policy — run push' }
    if (pol.pendingCommits && pending >= pol.pendingCommits) return { due: true, pending, reason: `${pending} pending commits ≥ ${pol.pendingCommits}` }
    if (pol.mode === 'interval' && pol.intervalMinutes) {
      const oldest = Math.min(...pendingIds.map((id) => Date.parse(this.store.getCommit(id)!.timestamp)))
      const ageMin = (now - oldest) / 60_000
      if (ageMin >= pol.intervalMinutes) return { due: true, pending, reason: `oldest pending commit is ${Math.round(ageMin)} min old ≥ ${pol.intervalMinutes}` }
      return { due: false, pending, reason: `oldest pending commit is ${Math.round(ageMin)} min old; publishes at ${pol.intervalMinutes}` }
    }
    return { due: false, pending, reason: 'below threshold' }
  }

  // ---- policy ----

  setPolicy(patch: Partial<Policy>): Policy {
    this.require('admin', 'change the policy')
    const refs = this.store.readRefs()
    refs.policy = { ...refs.policy, ...patch }
    refs.updatedAt = new Date().toISOString()
    this.store.writeRefs(refs)
    return refs.policy
  }

  describe(meta: { title?: string; description?: string }): void {
    this.require('admin', 'describe the namespace')
    const refs = this.store.readRefs()
    if (meta.title !== undefined) refs.title = meta.title
    if (meta.description !== undefined) refs.description = meta.description
    this.store.writeRefs(refs)
  }

  // ---- sources (PRD: source-aware namespaces) ----

  sources(): SourceConnection[] {
    const refs = this.store.readRefs()
    const snap = this.headSnapshot(refs.head)
    return Object.values(refs.sources ?? {}).map((c) => ({
      ...c,
      objects: Object.values(snap).filter((k) => k.sources.some((s) => (s.name ?? '').toLowerCase() === c.name.toLowerCase())).length,
    }))
  }

  /** Connect a source to this namespace. Its imports are attributed to `contributor`. */
  connectSource(input: { name: string; kind: SourceKind; description?: string; contributor?: string }): SourceConnection {
    this.require('admin', 'connect a source')
    const refs = this.store.readRefs()
    const id = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
    const c: SourceConnection = {
      id, name: input.name, kind: input.kind, ...(input.description ? { description: input.description } : {}),
      contributor: input.contributor ?? `${id}-import`, status: 'connected', connectedAt: new Date().toISOString(),
    }
    refs.sources = { ...(refs.sources ?? {}), [id]: c }
    refs.updatedAt = c.connectedAt
    this.store.writeRefs(refs)
    return c
  }

  /** Record a child namespace (e.g. india.history.eth under history.eth). */
  addChild(namespace: string): void {
    const refs = this.store.readRefs()
    if (!refs.children.includes(namespace)) { refs.children.push(namespace); this.store.writeRefs(refs) }
  }

  /** Committing to the default branch is a reviewer/owner action. Call before staging to avoid a half-done write. */
  assertCanCommit(): void { this.requireCommitHere() }

  private requireCommitHere(): void {
    if (this.branch === this.store.readRefs().head) this.require('commit', `commit directly to ${this.branch}`)
  }

  private require(action: Action, what: string): void {
    if (!can(this.policy, this.identity, action)) {
      throw new Error(`${this.identity} may not ${what} on ${this.namespace} (roles: ${this.roles().join(', ')})`)
    }
  }

  private fail(msg: string): never { throw new Error(msg) }
}

function ancestorsOf(lookup: (id: string) => Commit | undefined, from: string): Set<string> {
  const seen = new Set<string>(); const stack = [from]
  while (stack.length) { const id = stack.pop()!; if (seen.has(id)) continue; const c = lookup(id); if (!c) continue; seen.add(id); stack.push(...c.parents) }
  return seen
}
