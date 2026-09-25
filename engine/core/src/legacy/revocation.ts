/**
 * Revocation.
 *
 * A marketplace can delist a bad skill; copies already installed keep running.
 * The point of this module is that a revoked skill stops being served to
 * everyone, **including subscribers who have pinned**.
 *
 * That distinction is the whole feature:
 *
 *   - **Pinning** protects a subscriber from unwanted *updates*. They chose a
 *     version and updates do not reach them.
 *   - **Revocation** protects them from a *compromised* entry. It is not an
 *     update, and a pin must not shield them from it.
 *
 * They are separate channels and are implemented as such: pin state lives in the
 * local cache, revocation is read from chain on every call. If the two ever get
 * merged into one "should I serve this version" check, the feature is gone.
 */
import { MAX_REVOKED_IDS } from './collection.js'

/**
 * Parse the `recall.revoked` record.
 *
 * Comma-separated entry ids. Tolerant of whitespace and empty segments because
 * it is hand-edited under pressure — the moment you use it is the moment
 * something has gone wrong.
 */
export function parseRevoked(record: string): string[] {
  if (!record) return []
  return [...new Set(record.split(',').map((s) => s.trim()).filter(Boolean))]
}

/** Serialise ids for the record. Throws past the cap rather than truncating. */
export function serialiseRevoked(ids: string[]): string {
  const unique = [...new Set(ids.map((s) => s.trim()).filter(Boolean))].sort()
  if (unique.length > MAX_REVOKED_IDS) {
    throw new Error(
      `${unique.length} revoked ids exceeds the ${MAX_REVOKED_IDS} cap. ` +
        'Silently dropping ids would leave a revoked skill being served.',
    )
  }
  return unique.join(',')
}

/**
 * The outcome of checking a collection's revocation list.
 *
 * `ok: false` is not "nothing revoked" — it means the check itself failed and
 * the caller must serve nothing from this collection.
 */
export type RevocationCheck =
  | { ok: true; revoked: Set<string>; checkedAt: number }
  | { ok: false; error: string; checkedAt: number }

/**
 * Decide whether an entry may be served.
 *
 * Fail closed. A revocation check that silently passes on a network failure is
 * a security bug: an attacker who can disrupt the RPC read would re-enable
 * every revoked skill.
 */
export function mayServe(check: RevocationCheck, entryId: string): boolean {
  if (!check.ok) return false
  return !check.revoked.has(entryId)
}

/** Filter a list of entries through a revocation check, failing closed. */
export function filterRevoked<T extends { id: string }>(
  check: RevocationCheck,
  entries: T[],
): { served: T[]; withheld: T[] } {
  if (!check.ok) return { served: [], withheld: entries }
  const served: T[] = []
  const withheld: T[] = []
  for (const e of entries) (check.revoked.has(e.id) ? withheld : served).push(e)
  return { served, withheld }
}

/**
 * How long a revocation answer may be reused.
 *
 * Short on purpose. This is the one read that must not go stale — the window
 * between a publisher revoking and every subscriber stopping is exactly this
 * number.
 */
export const REVOCATION_CACHE_MS = 60_000

export function isFresh(check: RevocationCheck, now = Date.now()): boolean {
  return now - check.checkedAt < REVOCATION_CACHE_MS
}

/** A one-line notice naming what was withheld and from where. */
export function revocationNotice(
  collection: string,
  withheld: { id: string; name?: string }[],
): string {
  if (withheld.length === 0) return ''
  const names = withheld.map((w) => (w.name ? `${w.name} (${w.id})` : w.id)).join(', ')
  return (
    `WITHHELD: ${withheld.length} skill(s) revoked by the publisher of ${collection} ` +
    `and not served: ${names}. This overrides any pinned version.`
  )
}

/** The notice shown when the check itself could not be completed. */
export function failClosedNotice(collection: string, error: string): string {
  return (
    `WITHHELD: could not read the revocation list for ${collection} (${error}). ` +
    'Nothing from this collection is being served. This is deliberate — serving ' +
    'skills without a revocation check would make a revoked skill reachable by ' +
    'disrupting the network.'
  )
}
