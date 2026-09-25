/**
 * Walking the commit graph.
 *
 * Everything here takes a lookup function rather than a store, so the same
 * code serves the local repo (a Map) and a remote reader (fetch on demand).
 */
import type { Commit } from './objects.js'

export type Lookup = (id: string) => Commit | undefined

/**
 * History from `from`, newest first, following first parents — what `log`
 * shows. Merge parents are listed in the commit but not followed here, which
 * keeps the log a line rather than a lattice.
 */
export function log(lookup: Lookup, from: string, limit = 100): Commit[] {
  const out: Commit[] = []
  let cur: string | undefined = from
  while (cur && out.length < limit) {
    const c = lookup(cur)
    if (!c) break
    out.push(c)
    cur = c.parents[0]
  }
  return out
}

/** Every commit reachable from `from`, across all parents. */
export function ancestors(lookup: Lookup, from: string): Set<string> {
  const seen = new Set<string>()
  const stack = [from]
  while (stack.length) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    const c = lookup(id)
    if (!c) continue
    seen.add(id)
    stack.push(...c.parents)
  }
  return seen
}

export const isAncestor = (lookup: Lookup, maybeAncestor: string, of: string): boolean =>
  ancestors(lookup, of).has(maybeAncestor)

/**
 * Nearest common ancestor of two commits — the base for a three-way merge.
 * BFS from `a`, first hit in `b`'s ancestor set wins.
 */
export function mergeBase(lookup: Lookup, a: string, b: string): string | undefined {
  const inB = ancestors(lookup, b)
  const seen = new Set<string>()
  const queue = [a]
  while (queue.length) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    if (inB.has(id)) return id
    const c = lookup(id)
    if (c) queue.push(...c.parents)
  }
  return undefined
}

/** Commits reachable from `heads` that are not in `known`. Used by push. */
export function missing(lookup: Lookup, heads: string[], known: Set<string>): Commit[] {
  const out: Commit[] = []
  const seen = new Set<string>()
  const stack = [...heads]
  while (stack.length) {
    const id = stack.pop()!
    if (seen.has(id) || known.has(id)) continue
    seen.add(id)
    const c = lookup(id)
    if (!c) continue
    out.push(c)
    stack.push(...c.parents)
  }
  // Parents before children, so a reader can verify as it goes.
  return out.reverse()
}
