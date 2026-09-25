/**
 * Forking and upstream sync.
 *
 * Skills fork constantly and legitimately: a team wants someone else's
 * conventions with their own judgement layered on top. So a fork is not a
 * snapshot — it keeps pulling upstream while preserving what the forker added.
 *
 * The whole merge policy is **one rule: local wins.** No three-way merge, no
 * rebase, no history rewriting. That is a deliberate ceiling, not an omission —
 * the moment fork semantics start reimplementing git, this stops being a
 * distribution layer.
 *
 * Sync is never automatic. An upstream sync is a supply-chain event and a
 * maintainer approves every one.
 */
import {
  diffEntries,
  type Collection,
  type Entry,
  type Manifest,
} from './collection.js'

/** How deep to walk ancestry when displaying it. */
export const MAX_ANCESTRY_DEPTH = 5

// ---------------------------------------------------------------------------
// Manifest diffing
// ---------------------------------------------------------------------------

export type ManifestDiff = {
  /** Capability the entry did not previously declare. */
  added: { field: keyof Manifest; value: string }[]
  removed: { field: keyof Manifest; value: string }[]
  /** True when anything was added — the direction that matters. */
  widened: boolean
}

/**
 * Compare two manifests.
 *
 * Only `added` makes something more dangerous, so `widened` singles it out. A
 * skill that quietly gains a write path or an endpoint between versions is the
 * exact pattern worth catching at review time.
 */
export function diffManifest(before: Manifest, after: Manifest): ManifestDiff {
  const added: ManifestDiff['added'] = []
  const removed: ManifestDiff['removed'] = []

  for (const field of ['reads', 'writes', 'endpoints', 'tools'] as const) {
    const b = new Set(before[field])
    const a = new Set(after[field])
    for (const v of a) if (!b.has(v)) added.push({ field, value: v })
    for (const v of b) if (!a.has(v)) removed.push({ field, value: v })
  }
  return { added, removed, widened: added.length > 0 }
}

// ---------------------------------------------------------------------------
// Fork creation
// ---------------------------------------------------------------------------

/**
 * Build the document for a fork of `upstream`.
 *
 * Every inherited entry is marked `origin: 'upstream'` so a later sync can tell
 * what it may replace from what the forker added.
 */
export function forkCollection(params: {
  upstream: Collection
  upstreamRef: string | null
  name: string
}): Collection {
  const { upstream, upstreamRef, name } = params
  return {
    ...upstream,
    collection: name,
    parent: null,
    upstream: upstream.collection,
    upstreamRef,
    suppressed: [],
    updatedAt: Math.floor(Date.now() / 1000),
    entries: upstream.entries.map((e) => ({ ...e, origin: 'upstream' as const })),
  }
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export type SyncReport = {
  /** True when upstream has not moved since the last sync. */
  noop: boolean
  upstreamRef: string | null
  added: Entry[]
  removed: Entry[]
  changed: { id: string; before: Entry; after: Entry; manifest: ManifestDiff }[]
  /** Upstream entries dropped because a local entry owns the id. */
  overridden: { id: string; local: Entry; upstream: Entry }[]
  /** Upstream entries dropped because the id is suppressed. */
  suppressed: Entry[]
  /** Upstream entries this fork carries that upstream has since revoked. */
  revokedUpstream: Entry[]
  /** True when any surviving change widens a permission manifest. */
  anyManifestWidened: boolean
}

export type SyncResult = {
  collection: Collection
  report: SyncReport
}

/**
 * Apply an upstream collection to a fork.
 *
 * Candidate set:
 *   - local entries are **always preserved**;
 *   - upstream entries are replaced wholesale with the new upstream set;
 *   - an id held by both is kept local, and the upstream one is dropped and
 *     reported;
 *   - suppressed ids are skipped entirely.
 *
 * Returns the proposed document and a report. Nothing is written — the caller
 * shows the report to a maintainer, who decides.
 */
export function syncUpstream(params: {
  fork: Collection
  upstream: Collection
  upstreamRef: string | null
  /** Entry ids upstream has revoked, so the fork can flag what it carries. */
  upstreamRevoked?: string[]
}): SyncResult {
  const { fork, upstream, upstreamRef } = params
  const revoked = new Set(params.upstreamRevoked ?? [])

  if (upstreamRef !== null && upstreamRef === fork.upstreamRef) {
    return {
      collection: fork,
      report: {
        noop: true,
        upstreamRef,
        added: [],
        removed: [],
        changed: [],
        overridden: [],
        suppressed: [],
        revokedUpstream: [],
        anyManifestWidened: false,
      },
    }
  }

  const localEntries = fork.entries.filter((e) => e.origin === 'local')
  const localIds = new Set(localEntries.map((e) => e.id))
  const suppressedIds = new Set(fork.suppressed)
  const carriedBefore = new Map(
    fork.entries.filter((e) => e.origin === 'upstream').map((e) => [e.id, e]),
  )

  const overridden: SyncReport['overridden'] = []
  const suppressed: Entry[] = []
  const revokedUpstream: Entry[] = []
  const nextUpstream: Entry[] = []

  for (const entry of upstream.entries) {
    if (suppressedIds.has(entry.id)) {
      suppressed.push(entry)
      continue
    }
    if (localIds.has(entry.id)) {
      overridden.push({
        id: entry.id,
        local: localEntries.find((e) => e.id === entry.id)!,
        upstream: entry,
      })
      continue
    }
    if (revoked.has(entry.id)) {
      // Carried but revoked upstream. Surfaced for a decision rather than
      // dropped: the fork may have legitimate reasons to keep it.
      revokedUpstream.push(entry)
    }
    nextUpstream.push({ ...entry, origin: 'upstream' })
  }

  const collection: Collection = {
    ...fork,
    upstream: upstream.collection,
    upstreamRef,
    updatedAt: Math.floor(Date.now() / 1000),
    entries: [...localEntries, ...nextUpstream].sort((a, b) => (a.id < b.id ? -1 : 1)),
  }

  // Report only on the inherited half; local entries are untouched by a sync.
  const carriedAfter = new Map(nextUpstream.map((e) => [e.id, e]))
  const added = nextUpstream.filter((e) => !carriedBefore.has(e.id))
  const removed = [...carriedBefore.values()].filter(
    (e) => !carriedAfter.has(e.id) && !localIds.has(e.id) && !suppressedIds.has(e.id),
  )
  const changed: SyncReport['changed'] = []
  for (const [id, after] of carriedAfter) {
    const before = carriedBefore.get(id)
    if (!before) continue
    const manifest = diffManifest(before.manifest, after.manifest)
    const bodyChanged = before.body !== after.body || before.version !== after.version
    if (bodyChanged || manifest.added.length || manifest.removed.length) {
      changed.push({ id, before, after, manifest })
    }
  }

  return {
    collection,
    report: {
      noop: false,
      upstreamRef,
      added,
      removed,
      changed,
      overridden,
      suppressed,
      revokedUpstream,
      anyManifestWidened:
        changed.some((c) => c.manifest.widened) ||
        // A newly inherited entry that declares anything is also worth a look.
        added.some((e) => Object.values(e.manifest).some((v) => v.length > 0)),
    },
  }
}

/** Suppress an upstream entry id so sync stops reintroducing it. */
export function suppress(collection: Collection, id: string): Collection {
  if (collection.suppressed.includes(id)) return collection
  return {
    ...collection,
    suppressed: [...collection.suppressed, id].sort(),
    entries: collection.entries.filter((e) => !(e.id === id && e.origin === 'upstream')),
    updatedAt: Math.floor(Date.now() / 1000),
  }
}

export function unsuppress(collection: Collection, id: string): Collection {
  return {
    ...collection,
    suppressed: collection.suppressed.filter((s) => s !== id),
    updatedAt: Math.floor(Date.now() / 1000),
  }
}

/** Add a local entry, overriding an inherited one of the same id if present. */
export function addLocalEntry(collection: Collection, entry: Entry): Collection {
  const local: Entry = { ...entry, origin: 'local' }
  const entries = collection.entries.filter((e) => e.id !== entry.id)
  entries.push(local)
  return {
    ...collection,
    entries: entries.sort((a, b) => (a.id < b.id ? -1 : 1)),
    updatedAt: Math.floor(Date.now() / 1000),
  }
}

export { diffEntries }
