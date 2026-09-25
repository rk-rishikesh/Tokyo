/**
 * The developer-facing facade — what an application imports.
 *
 *   const history = Namespace.for('history.eth')
 *   history.search('Indian independence')
 *   history.contribute({ title: 'Add partition context', items: [...] })
 *
 *   const alice = Namespace.for('alice.eth', { agent: 'shopping-agent' })   // personal memory: same primitive
 *   alice.observe({ observation: 'User prefers Nike running shoes', topic: 'shopping', confidence: 0.87 })
 *
 * A thin layer over `Repository`: the same objects, the same history, the same
 * explorer. The namespace owner sets the policy; the application acts under its
 * own name, and every write is a commit or a proposal the owner can see,
 * question, review and undo.
 */
import type { Commit, Hit, Knowledge, NewKnowledge, ObserveOptions, Observation, Proposal, Provenance, Source } from '@knowledge01/core'
import { searchSnapshot } from '@knowledge01/core'
import { Repository } from './repository.js'
import { RepoStore, repoPath } from './store.js'

export type NamespaceOptions = {
  /** Name recorded as contributor of everything this client writes, e.g. "shopping-agent". */
  agent?: string
  /** Default confidence threshold for `observe`. */
  threshold?: number
  /** Content key for a private namespace this machine has not seen before. */
  contentKey?: string
}

export type Item = { claim: string; subject?: string | null; topic?: string | null; type?: string; confidence?: number; sources?: Source[]; tags?: string[] }

export class Namespace {
  private constructor(readonly repo: Repository, private readonly opts: NamespaceOptions) {}

  /** Open a namespace, creating the local repository if needed. */
  static for(name: string, opts: NamespaceOptions = {}): Namespace {
    const repo = RepoStore.exists(repoPath(name))
      ? Repository.open(name)
      : Repository.init(name, opts.agent ?? name, opts.contentKey ? { contentKey: opts.contentKey } : {})
    return new Namespace(repo, opts)
  }

  get name(): string { return this.repo.namespace }
  get version(): number { return this.repo.version(this.repo.refs.head) }

  private author(): { contributor?: string } { return this.opts.agent ? { contributor: this.opts.agent } : {} }
  private toNew(i: Item): Omit<NewKnowledge, 'contributor'> {
    return { claim: i.claim, ...(i.subject !== undefined ? { subject: i.subject } : {}), ...(i.topic !== undefined ? { topic: i.topic } : {}), ...(i.type ? { type: i.type } : {}), ...(i.confidence !== undefined ? { confidence: i.confidence } : {}), ...(i.sources ? { sources: i.sources } : {}), ...(i.tags ? { tags: i.tags } : {}) }
  }

  // ---- consume ----

  search(query: string, opts: { topic?: string; subject?: string; type?: string; limit?: number; minConfidence?: number } = {}): Hit[] {
    return searchSnapshot(this.repo.headSnapshot(this.repo.refs.head), query, opts)
  }
  get(id: string): Knowledge | undefined { return this.repo.headSnapshot(this.repo.refs.head)[id] }
  all(): Knowledge[] { return Object.values(this.repo.headSnapshot(this.repo.refs.head)) }
  why(id: string): Provenance | undefined { return this.repo.why(id, this.repo.refs.head) }
  history(limit = 50): Commit[] { return this.repo.log(this.repo.refs.head, limit) }

  // ---- contribute (goes through review) ----

  /**
   * Propose knowledge: a branch, one commit, one proposal. Lands on the default
   * branch only after review, per the namespace policy.
   */
  contribute(input: { title: string; description?: string; items: Item[] }): Proposal {
    const prev = this.repo.branch
    const branch = `contrib/${Date.now().toString(36)}`
    this.repo.checkout(branch, { create: true })
    try {
      for (const i of input.items) this.repo.add({ ...this.toNew(i), ...this.author() })
      this.repo.commit(input.title, this.opts.agent ? { author: this.opts.agent } : {})
      return this.repo.propose({ title: input.title, ...(input.description ? { description: input.description } : {}), branch })
    } finally {
      this.repo.checkout(prev)
    }
  }

  // ---- write directly (owner / reviewer, or a personal namespace) ----

  /** Report something observed. Committed only if it clears the bar; conflicts are returned, not applied. */
  observe(input: { observation: string } & Omit<Item, 'claim'>, opts: ObserveOptions & { commit?: boolean } = {}): { proposal: Observation; commit?: Commit } {
    const { observation, ...rest } = input
    return this.repo.observe({ ...this.toNew({ claim: observation, ...rest }), ...this.author() },
      { ...(this.opts.threshold !== undefined ? { threshold: this.opts.threshold } : {}), ...opts })
  }

  /** Add unconditionally — the caller has already decided. Requires commit rights on the default branch. */
  remember(input: Item & { message?: string }): { knowledge: Knowledge; commit: Commit } {
    const { message, ...item } = input
    return this.repo.remember({ ...this.toNew(item), ...this.author(), ...(message ? { message } : {}) })
  }

  update(id: string, patch: Partial<Pick<Knowledge, 'claim' | 'subject' | 'type' | 'topic' | 'confidence' | 'tags' | 'sources'>>, message?: string): { knowledge: Knowledge; commit: Commit } {
    const knowledge = this.repo.update(id, patch)
    return { knowledge, commit: this.repo.commit(message ?? `revise: ${knowledge.claim.slice(0, 60)}`) }
  }

  forget(id: string, message?: string): Commit {
    if (!this.repo.remove(id)) throw new Error(`no knowledge ${id}`)
    return this.repo.commit(message ?? `remove: ${id}`)
  }
}

/** Personal memory is a namespace like any other. */
export const Memory = Namespace
