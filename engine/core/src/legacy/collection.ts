/**
 * The collection document: schema, validation, merge, fork and the
 * fast-forward check.
 *
 * Entries are **skills** — SKILL.md payloads an agent loads and follows. Two
 * consequences run through everything below:
 *
 *   - A skill body is *instruction-shaped*. Everything that hands one to an
 *     agent must mark it as third-party reference data rather than something to
 *     obey. See `engine/mcp/src/format.ts`.
 *   - Skills fork. Teams legitimately want a variant of someone else's
 *     convention, which is why `origin`, `suppressed` and the upstream fields
 *     exist and why the merge rule is the way it is.
 *
 * Plain JSON with a `parent` pointer, deliberately not an IPLD DAG.
 * `entry.id` is stable and never rewritten: it is the merge key, the override
 * key, the suppression key and the revocation key.
 */
import type { Address } from 'viem'

export const COLLECTION_SCHEMA = 'recall/skill-list/1'

/** Largest SKILL.md we accept. Beyond this it is a document, not a skill. */
export const MAX_BODY_BYTES = 64 * 1024

/** Most entry ids a single revocation record can carry. */
export const MAX_REVOKED_IDS = 64

/**
 * What a skill declares it touches.
 *
 * **This is a claim, not a control.** Recall stores it, shows it, and diffs it;
 * it does not sandbox anything and cannot stop a skill doing whatever it does.
 * The value is that a skill quietly gaining filesystem write access between
 * versions becomes visible at review time. Never describe it as enforced.
 */
export type Manifest = {
  /** Globs the skill expects to read. */
  reads: string[]
  /** Globs the skill expects to write. */
  writes: string[]
  /** Network endpoints it calls. */
  endpoints: string[]
  /** Tools it invokes. */
  tools: string[]
}

export const EMPTY_MANIFEST: Manifest = {
  reads: [],
  writes: [],
  endpoints: [],
  tools: [],
}

/**
 * Where an entry came from.
 *
 * Set by the merge engine, never by a contributor — a contributor who could
 * write `origin: "upstream"` could disguise their own entry as inherited, which
 * is the provenance claim this whole thing rests on.
 */
export type Origin = 'local' | 'upstream'

export type Entry = {
  /** Stable kebab-case id. Merge key, override key, suppression key. */
  id: string
  name: string
  /** Semver, publisher-managed. Advisory only — do not resolve on it. */
  version: string
  /** The SKILL.md payload, served verbatim to the agent. */
  body: string
  manifest: Manifest
  tags: string[]
  author: Address
  /** Block at which it was merged. 0 while still a proposal. */
  mergedAt: number
  origin: Origin
}

export type Collection = {
  schema: typeof COLLECTION_SCHEMA
  /** Fully-qualified ENS name, e.g. "skills.acme.eth". */
  collection: string
  /** Previous ref string, or null for the first version. */
  parent: string | null
  /**
   * Upstream collection this one forked from, or null for a root collection.
   * The chain record `recall.upstream` is canonical; this is for offline diffing.
   */
  upstream: string | null
  /** Upstream ref at the last successful sync. */
  upstreamRef: string | null
  /**
   * Upstream entry ids deliberately dropped.
   *
   * Without this a scope fork is impossible: deleting an inherited entry would
   * simply bring it back on the next sync.
   */
  suppressed: string[]
  /** A longer introduction for subscribers. */
  readme?: string
  updatedAt: number
  entries: Entry[]
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export class CollectionValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid collection document:\n  - ${issues.join('\n  - ')}`)
    this.name = 'CollectionValidationError'
  }
}

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const ADDRESS = /^0x[0-9a-fA-F]{40}$/

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string')

function validateManifest(m: unknown, path: string, issues: string[]): void {
  if (typeof m !== 'object' || m === null) {
    // Omission is not the same as "declares nothing" — an empty manifest has to
    // be written down, so that "we checked and it touches nothing" is
    // distinguishable from "nobody said".
    issues.push(`${path} is required; use an explicit empty manifest rather than omitting it`)
    return
  }
  const man = m as Record<string, unknown>
  for (const key of ['reads', 'writes', 'endpoints', 'tools'] as const) {
    if (!isStringArray(man[key])) {
      issues.push(`${path}.${key} must be an array of strings`)
    }
  }
}

/** Validate an entry. `fromContributor` tightens the rules for proposals. */
function validateEntry(
  e: unknown,
  path: string,
  issues: string[],
  fromContributor: boolean,
): void {
  if (typeof e !== 'object' || e === null) {
    issues.push(`${path} is not an object`)
    return
  }
  const entry = e as Record<string, unknown>

  if (typeof entry.id !== 'string' || !KEBAB.test(entry.id)) {
    issues.push(`${path}.id must be kebab-case, got ${JSON.stringify(entry.id)}`)
  }
  if (typeof entry.name !== 'string' || entry.name.length === 0) {
    issues.push(`${path}.name must be a non-empty string`)
  }
  if (typeof entry.body !== 'string' || entry.body.length === 0) {
    issues.push(`${path}.body must be a non-empty SKILL.md payload`)
  } else if (new TextEncoder().encode(entry.body).length > MAX_BODY_BYTES) {
    issues.push(`${path}.body exceeds ${MAX_BODY_BYTES} bytes`)
  }
  if (typeof entry.version !== 'string' || entry.version.length === 0) {
    issues.push(`${path}.version must be a semver string`)
  }
  validateManifest(entry.manifest, `${path}.manifest`, issues)
  if (!isStringArray(entry.tags)) {
    issues.push(`${path}.tags must be an array of strings`)
  }
  if (typeof entry.author !== 'string' || !ADDRESS.test(entry.author)) {
    issues.push(`${path}.author must be an address, got ${JSON.stringify(entry.author)}`)
  }
  if (
    typeof entry.mergedAt !== 'number' ||
    !Number.isInteger(entry.mergedAt) ||
    entry.mergedAt < 0
  ) {
    issues.push(`${path}.mergedAt must be a non-negative integer block number`)
  }

  if (fromContributor) {
    if (entry.origin !== undefined) {
      issues.push(
        `${path}.origin is set by the merge engine, not by a contributor — ` +
          'a contributor who could set it could disguise their entry as inherited',
      )
    }
  } else if (entry.origin !== 'local' && entry.origin !== 'upstream') {
    issues.push(`${path}.origin must be "local" or "upstream"`)
  }
}

export type ValidateOptions = {
  /** True when the document came from a contributor rather than the engine. */
  fromContributor?: boolean
}

/** Validate an untrusted object as a collection. Throws. */
export function validateCollection(
  input: unknown,
  opts: ValidateOptions = {},
): Collection {
  const issues: string[] = []
  if (typeof input !== 'object' || input === null) {
    throw new CollectionValidationError(['document is not an object'])
  }
  const d = input as Record<string, unknown>

  if (d.schema !== COLLECTION_SCHEMA) {
    issues.push(`schema must be "${COLLECTION_SCHEMA}", got ${JSON.stringify(d.schema)}`)
  }
  if (typeof d.collection !== 'string' || d.collection.length === 0) {
    issues.push('collection must be a non-empty ENS name')
  }
  if (d.parent !== null && typeof d.parent !== 'string') {
    issues.push('parent must be a ref string or null')
  }
  if (d.upstream !== null && d.upstream !== undefined && typeof d.upstream !== 'string') {
    issues.push('upstream must be an ENS name or null')
  }
  if (
    d.upstreamRef !== null &&
    d.upstreamRef !== undefined &&
    typeof d.upstreamRef !== 'string'
  ) {
    issues.push('upstreamRef must be a ref string or null')
  }
  if (d.suppressed !== undefined && !isStringArray(d.suppressed)) {
    issues.push('suppressed must be an array of entry ids')
  }
  if (d.readme !== undefined && typeof d.readme !== 'string') {
    issues.push('readme must be a string when present')
  }
  if (typeof d.updatedAt !== 'number' || !Number.isInteger(d.updatedAt)) {
    issues.push('updatedAt must be a unix timestamp')
  }

  if (!Array.isArray(d.entries)) {
    issues.push('entries must be an array')
  } else {
    d.entries.forEach((e, i) =>
      validateEntry(e, `entries[${i}]`, issues, opts.fromContributor ?? false),
    )
    const seen = new Set<string>()
    for (const e of d.entries as Entry[]) {
      if (e && typeof e.id === 'string') {
        if (seen.has(e.id)) issues.push(`duplicate entry id "${e.id}"`)
        seen.add(e.id)
      }
    }
  }

  if (issues.length) throw new CollectionValidationError(issues)
  return normalise(input as Collection)
}

/** Fill in optional fields so downstream code never has to guard them. */
function normalise(c: Collection): Collection {
  return {
    ...c,
    upstream: c.upstream ?? null,
    upstreamRef: c.upstreamRef ?? null,
    suppressed: c.suppressed ?? [],
  }
}

export function parseCollection(bytes: Uint8Array, opts: ValidateOptions = {}): Collection {
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes))
  } catch (e) {
    throw new CollectionValidationError([`not valid JSON: ${(e as Error).message}`])
  }
  return validateCollection(parsed, opts)
}

/** Serialise to canonical bytes, entries sorted by id. */
export function serialiseCollection(collection: Collection): Uint8Array {
  const canonical: Collection = {
    ...collection,
    suppressed: [...collection.suppressed].sort(),
    entries: [...collection.entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  }
  return new TextEncoder().encode(JSON.stringify(canonical, null, 2))
}

export function emptyCollection(name: string): Collection {
  return {
    schema: COLLECTION_SCHEMA,
    collection: name,
    parent: null,
    upstream: null,
    upstreamRef: null,
    suppressed: [],
    updatedAt: Math.floor(Date.now() / 1000),
    entries: [],
  }
}

// ---------------------------------------------------------------------------
// Fast-forward
// ---------------------------------------------------------------------------

/**
 * A proposal written against a ref that is no longer current is stale and must
 * not be merged: the contributor read one state and edited another.
 */
export function isFastForward(
  parentRef: string | null,
  currentRef: string | null,
): boolean {
  return (parentRef ?? null) === (currentRef ?? null)
}

export type StaleCheck = {
  stale: boolean
  parentRef: string | null
  currentRef: string | null
  reason?: string
}

export function checkStale(
  parentRef: string | null,
  currentRef: string | null,
): StaleCheck {
  const stale = !isFastForward(parentRef, currentRef)
  return {
    stale,
    parentRef: parentRef ?? null,
    currentRef: currentRef ?? null,
    ...(stale
      ? {
          reason: `proposal was written against ${parentRef ?? '(empty collection)'} but the collection is now at ${currentRef ?? '(empty collection)'}`,
        }
      : {}),
  }
}

// ---------------------------------------------------------------------------
// Diff and merge
// ---------------------------------------------------------------------------

export type EntryChange =
  | { kind: 'added'; id: string; entry: Entry }
  | { kind: 'removed'; id: string; entry: Entry }
  | { kind: 'modified'; id: string; before: Entry; after: Entry }

export type Conflict = { id: string; base: Entry; ours: Entry; theirs: Entry }

export type MergeResult = {
  collection: Collection
  changes: EntryChange[]
  conflicts: Conflict[]
}

const sameManifest = (a: Manifest, b: Manifest): boolean =>
  (['reads', 'writes', 'endpoints', 'tools'] as const).every(
    (k) => a[k].length === b[k].length && a[k].every((v, i) => v === b[k][i]),
  )

const sameEntry = (a: Entry, b: Entry): boolean =>
  a.name === b.name &&
  a.body === b.body &&
  a.version === b.version &&
  a.author.toLowerCase() === b.author.toLowerCase() &&
  a.tags.length === b.tags.length &&
  a.tags.every((t, i) => t === b.tags[i]) &&
  sameManifest(a.manifest, b.manifest)

export function diffEntries(before: Collection, after: Collection): EntryChange[] {
  const beforeById = new Map(before.entries.map((e) => [e.id, e]))
  const afterById = new Map(after.entries.map((e) => [e.id, e]))
  const changes: EntryChange[] = []

  for (const [id, entry] of afterById) {
    const prev = beforeById.get(id)
    if (!prev) changes.push({ kind: 'added', id, entry })
    else if (!sameEntry(prev, entry))
      changes.push({ kind: 'modified', id, before: prev, after: entry })
  }
  for (const [id, entry] of beforeById) {
    if (!afterById.has(id)) changes.push({ kind: 'removed', id, entry })
  }
  return changes.sort((a, b) => (a.id < b.id ? -1 : 1))
}

/**
 * Merge a proposal into the current collection — a union over `entries[].id`.
 *
 * The same id edited on both sides away from a common base is a conflict a
 * maintainer resolves; it is reported, not guessed at.
 */
export function mergeCollection(
  current: Collection,
  proposal: Collection,
  base: Collection = current,
): MergeResult {
  const baseById = new Map(base.entries.map((e) => [e.id, e]))
  const currentById = new Map(current.entries.map((e) => [e.id, e]))
  const merged = new Map<string, Entry>(currentById)
  const conflicts: Conflict[] = []

  for (const theirs of proposal.entries) {
    const ours = currentById.get(theirs.id)
    const original = baseById.get(theirs.id)

    if (!ours) {
      merged.set(theirs.id, theirs)
      continue
    }
    if (sameEntry(ours, theirs)) continue

    const oursChanged = !original || !sameEntry(original, ours)
    const theirsChanged = !original || !sameEntry(original, theirs)

    if (theirsChanged && !oursChanged) merged.set(theirs.id, theirs)
    else if (oursChanged && !theirsChanged) {
      // We already moved past their version; keep ours.
    } else conflicts.push({ id: theirs.id, base: original ?? ours, ours, theirs })
  }

  const collection: Collection = {
    ...current,
    entries: [...merged.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
    updatedAt: Math.floor(Date.now() / 1000),
  }
  return { collection, changes: diffEntries(current, collection), conflicts }
}

export function withEntry(collection: Collection, entry: Entry): Collection {
  const entries = collection.entries.filter((e) => e.id !== entry.id)
  entries.push(entry)
  return {
    ...collection,
    entries: entries.sort((a, b) => (a.id < b.id ? -1 : 1)),
    updatedAt: Math.floor(Date.now() / 1000),
  }
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72)
}

// ---------------------------------------------------------------------------
// On-chain record keys
// ---------------------------------------------------------------------------

export const COLLECTION_RECORDS = {
  schema: 'recall.schema',
  price: 'recall.price',
  storage: 'recall.storage',
  title: 'recall.title',
  description: 'recall.description',
  registrar: 'recall.registrar',
  /** Upstream collection ENS name, absent on a root collection. */
  upstream: 'recall.upstream',
  /** Upstream ref at the last successful sync. */
  upstreamRef: 'recall.upstreamRef',
  /**
   * Comma-separated entry ids that must never be served.
   *
   * A separate channel from pinning on purpose: a pin protects a subscriber
   * from unwanted *updates*, and must not protect them from a security
   * *revocation*.
   */
  revoked: 'recall.revoked',
  actHistory: 'recall.actHistory',
  actPublisher: 'recall.actPublisher',
} as const
