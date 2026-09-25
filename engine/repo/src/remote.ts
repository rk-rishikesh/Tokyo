/**
 * push / pull — the only part of the repository that touches ENS and IPFS.
 *
 * Public namespaces are published in plaintext: the point of cancer-research.eth is
 * that any agent can read it. Private and personal namespaces are encrypted.
 *
 * The published shape is deliberately minimal:
 *
 *   contenthash(namespace)  →  encrypted Refs object  →  commit id → CID
 *                                                     →  branch  → commit id
 *
 * Commits are pushed as individual encrypted objects; the refs object indexes
 * them. So a push is N uploads plus **one** pointer move on chain, however many
 * commits or branches it carries — the same economics as `git push`.
 *
 * The chain and storage sides are behind a small interface so the repository
 * logic is testable with an in-memory adapter and a fake pointer.
 */
import {
  decodeObject, encodeObject, missing, validateCommit, verifyCommit,
  type Commit, type ProposalBundle, type Refs,
} from '@knowledge01/core'
import type { StorageAdapter, StorageRef } from '@knowledge01/storage'
import type { Hex } from 'viem'
import { Repository } from './repository.js'

/** Where the namespace's pointer lives. Chain-backed in production, a variable in tests. */
export interface Pointer {
  /** Current contenthash for the namespace, or null if unset. */
  read(): Promise<Hex | null>
  /** Move the pointer. Returns a transaction hash or other receipt id. */
  write(contenthash: Hex): Promise<string>
}

export type PushResult = {
  pushed: Commit[]
  refsRef: StorageRef
  contenthash: Hex
  receipt: string | null
  /** True when nothing had changed and no transaction was sent. */
  noop: boolean
}

export type PullResult = {
  fetched: Commit[]
  fastForwarded: string[]
  created: string[]
  /** Branches where local and remote have both moved. Left untouched. */
  diverged: string[]
  remote: Refs | null
  /** How old the published version is — a reader must know it is looking at a snapshot (PRD W4). */
  publishedAt?: string
  ageMinutes?: number
}

export class Remote {
  constructor(
    private readonly repo: Repository,
    private readonly storage: StorageAdapter,
    private readonly pointer: Pointer,
  ) {}

  /** Public namespaces publish in plaintext (PRD §17); everything else is encrypted with the namespace key. */
  private ctx(): { collection: string; contentKey?: Uint8Array; plaintext?: boolean } {
    const cfg = this.repo.store.readConfig()
    if (this.repo.policy.readers === 'public') return { collection: cfg.namespace, plaintext: true }
    if (!cfg.contentKey) throw new Error('this namespace is private but the repository has no key — run `knowledge init --key <hex>`')
    return { collection: cfg.namespace, contentKey: Uint8Array.from(Buffer.from(cfg.contentKey.replace(/^0x/, ''), 'hex')) }
  }

  private identity(): { contentKey?: Uint8Array; plaintext?: boolean } {
    const c = this.ctx()
    return c.plaintext ? { plaintext: true } : { contentKey: c.contentKey! }
  }

  /** Publish every unpublished commit and move the pointer once. */
  async push(): Promise<PushResult> {
    const refs = this.repo.store.readRefs()
    const known = new Set(Object.keys(refs.objects))
    const toPush = missing(this.repo.store.getCommit, Object.values(refs.branches), known)
    const ctx = this.ctx()

    for (const c of toPush) {
      const ref = await this.storage.put(encodeObject(c), ctx)
      refs.objects[c.id] = ref.ref
    }

    // Compare against what is published before spending a transaction.
    const published: Refs = { ...refs, branches: { ...refs.branches }, objects: { ...refs.objects }, updatedAt: new Date().toISOString() }
    const current = await this.pointer.read()
    if (current && toPush.length === 0) {
      try {
        const remote = await this.fetchRefs(current)
        if (sameRefs(remote, published)) {
          this.repo.store.writeRefs(refs)
          return { pushed: [], refsRef: this.storage.fromContenthash(current), contenthash: current, receipt: null, noop: true }
        }
      } catch { /* unreadable remote: publish anyway */ }
    }

    const refsRef = await this.storage.put(encodeObject(published), ctx)
    const contenthash = this.storage.toContenthash(refsRef)
    const receipt = await this.pointer.write(contenthash)
    refs.updatedAt = published.updatedAt
    this.repo.store.writeRefs(refs)
    const cfg = this.repo.store.readConfig()
    this.repo.store.writeConfig({ ...cfg, publish: { ...(cfg.publish ?? {}), lastPublish: { at: published.updatedAt, version: this.repo.version(refs.head), contenthash, ...(refs.branches[refs.head] ? { commit: refs.branches[refs.head]! } : {}) } } })
    return { pushed: toPush, refsRef, contenthash, receipt, noop: false }
  }

  /** Fetch remote history and fast-forward local branches where safe. */
  async pull(): Promise<PullResult> {
    const current = await this.pointer.read()
    if (!current) return { fetched: [], fastForwarded: [], created: [], diverged: [], remote: null }
    const remote = await this.fetchRefs(current)

    // Fetch missing commits. Parents may arrive after children; validation only
    // needs the object itself, so order does not matter here.
    const fetched: Commit[] = []
    for (const [id, ref] of Object.entries(remote.objects)) {
      if (this.repo.store.hasCommit(id)) continue
      const bytes = await this.storage.get({ kind: this.storage.kind, ref }, this.identity())
      const c = decodeObject<Commit>(bytes)
      validateCommit(c)
      if (c.id !== id) throw new Error(`remote object ${id} decodes to a different commit ${c.id}`)
      this.repo.store.putCommit(c)
      fetched.push(c)
    }

    const refs = this.repo.store.readRefs()
    const fastForwarded: string[] = []
    const created: string[] = []
    const diverged: string[] = []
    for (const [name, remoteHead] of Object.entries(remote.branches)) {
      const localHead = refs.branches[name]
      if (!localHead) { refs.branches[name] = remoteHead; created.push(name); continue }
      if (localHead === remoteHead) continue
      if (isAncestorOf(this.repo, localHead, remoteHead)) { refs.branches[name] = remoteHead; fastForwarded.push(name); continue }
      if (isAncestorOf(this.repo, remoteHead, localHead)) continue // we are ahead
      diverged.push(name)
    }
    refs.objects = { ...refs.objects, ...remote.objects }
    // Shared review state, policy and description come from the published namespace.
    refs.policy = remote.policy
    refs.proposals = { ...refs.proposals, ...remote.proposals }
    if (remote.title) refs.title = remote.title
    if (remote.description) refs.description = remote.description
    if (remote.parent) refs.parent = remote.parent
    refs.children = [...new Set([...refs.children, ...remote.children])]
    refs.sources = { ...(refs.sources ?? {}), ...(remote.sources ?? {}) }
    this.repo.store.writeRefs(refs)

    const cfg = this.repo.store.readConfig()
    this.repo.store.writeConfig({ ...cfg, publish: { ...(cfg.publish ?? {}), lastPull: { at: new Date().toISOString(), remoteUpdatedAt: remote.updatedAt, version: this.repo.version(remote.head) } } })
    // Keep the working snapshot in step if the current branch moved.
    if (fastForwarded.includes(this.repo.branch) || created.includes(this.repo.branch)) {
      this.repo.store.writeIndex(this.repo.headSnapshot())
    }
    return { fetched, fastForwarded, created, diverged, remote, publishedAt: remote.updatedAt, ageMinutes: Math.max(0, Math.round((Date.now() - Date.parse(remote.updatedAt)) / 60_000)) }
  }

  /**
   * Fork-and-pull (PRD W5): publish a proposal bundle as a plaintext object and
   * record it in this namespace's outbox so the target's owner can find it.
   */
  async publishBundle(bundle: ProposalBundle): Promise<{ ref: StorageRef }> {
    const ref = await this.storage.put(encodeObject(bundle), { collection: this.repo.namespace, plaintext: true })
    const refs = this.repo.store.readRefs()
    refs.outbox[bundle.target] = [...new Set([...(refs.outbox[bundle.target] ?? []), ref.ref])]
    this.repo.store.writeRefs(refs)
    return { ref }
  }

  /** Fetch a bundle by CID (always plaintext — a proposal is meant to be read by its target's owner). */
  async fetchBundle(cid: string): Promise<ProposalBundle> {
    const b = decodeObject<ProposalBundle>(await this.storage.get({ kind: this.storage.kind, ref: cid }, { plaintext: true }))
    if (b.kind !== 'proposal-bundle') throw new Error(`${cid} is not a proposal bundle`)
    return b
  }

  /** Bundles a contributor namespace has published for this one: read their refs, look in the outbox. */
  async inboxFrom(contributorRefsContenthash: Hex): Promise<string[]> {
    const theirs = await this.fetchRefsPlain(contributorRefsContenthash)
    return theirs.outbox?.[this.repo.namespace] ?? []
  }

  private async fetchRefsPlain(contenthash: Hex): Promise<Refs> {
    const ref = this.storage.fromContenthash(contenthash)
    const refs = decodeObject<Refs>(await this.storage.get(ref, { plaintext: true }))
    if (refs.kind !== 'refs') throw new Error('contenthash does not point at a refs object')
    return refs
  }

  private async fetchRefs(contenthash: Hex): Promise<Refs> {
    const ref = this.storage.fromContenthash(contenthash)
    const bytes = await this.storage.get(ref, this.identity())
    const refs = decodeObject<Refs>(bytes)
    if (refs.kind !== 'refs') throw new Error('contenthash does not point at a refs object')
    return refs
  }
}

function isAncestorOf(repo: Repository, maybeAncestor: string, of: string): boolean {
  const seen = new Set<string>()
  const stack = [of]
  while (stack.length) {
    const id = stack.pop()!
    if (id === maybeAncestor) return true
    if (seen.has(id)) continue
    seen.add(id)
    const c = repo.store.getCommit(id)
    if (c) stack.push(...c.parents)
  }
  return false
}

function sameRefs(a: Refs, b: Refs): boolean {
  const k = (o: unknown) => JSON.stringify(o && typeof o === 'object' && !Array.isArray(o) ? Object.entries(o as Record<string, unknown>).sort() : o)
  return k(a.branches) === k(b.branches) && k(a.objects) === k(b.objects) && a.head === b.head
    && k(a.policy) === k(b.policy) && k(a.proposals) === k(b.proposals) && a.title === b.title && a.description === b.description && k(a.children) === k(b.children) && k(a.sources ?? {}) === k(b.sources ?? {})
}

export { verifyCommit }
