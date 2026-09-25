/**
 * The owner's namespaces, read from the working copies this app keeps, joined
 * with what the network holds for each. Server-only.
 */
import { accessOf, namespacesOf, type NamespaceAccess } from '@k01/connect'
import { Repository } from '@k01/repo'
import type { Commit, Knowledge, Proposal } from '@k01/core'

export type Owned = {
  access: NamespaceAccess
  head: Commit | undefined
  /** First-parent line of main, oldest first. */
  line: Commit[]
  /** Commit id of what the network holds, if anything. */
  publishedCommit: string | null
  proposals: Proposal[]
  /** Claims retired by a later claim — history keeps them, the snapshot does not. */
  superseded: Knowledge[]
  /** Claims on proposal branches that have not landed. */
  proposed: { proposal: Proposal; claim: Knowledge }[]
}

export async function owned(owner: string): Promise<Owned[]> {
  return Promise.all(namespacesOf(owner).map(async (ns) => {
    const repo = Repository.open(ns)
    const refs = repo.refs
    const line = repo.log(refs.head, 10_000).reverse()
    const head = line[line.length - 1]
    const seen = new Map<string, Knowledge>()
    for (const c of line) for (const k of Object.values(c.snapshot)) seen.set(k.id, k)
    const live = head?.snapshot ?? {}
    const retiredIds = new Set(Object.values(live).flatMap((k) => (k.supersedes ? [k.supersedes] : [])))
    const superseded = [...seen.values()].filter((k) => retiredIds.has(k.id) && !live[k.id])
    const proposals = repo.proposals()
    const proposed = proposals
      .filter((p) => !['committed', 'rejected'].includes(p.status))
      .flatMap((p) => {
        const tip = refs.branches[p.branch]
        const snap = tip ? repo.store.getCommit(tip)?.snapshot ?? {} : {}
        return Object.values(snap).filter((k) => !live[k.id]).map((claim) => ({ proposal: p, claim }))
      })
    return {
      access: await accessOf(ns),
      head,
      line,
      publishedCommit: repo.store.readConfig().publish?.lastPublish?.commit ?? null,
      proposals,
      superseded,
      proposed,
    }
  }))
}
