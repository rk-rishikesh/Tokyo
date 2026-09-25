/**
 * Reading revocation state from chain, with a short cache.
 *
 * This runs before **every** result the server returns. It is the one check
 * that must not be skipped, so it is deliberately separate from the collection
 * cache: that cache is keyed on `contenthash` and a pinned subscriber's copy
 * stays valid across updates, which is exactly the behaviour a revocation must
 * cut through.
 */
import { getText, parseRevoked, REVOCATION_CACHE_MS, type RevocationCheck } from '@knowledge01/core'
import { COLLECTION_RECORDS } from '@knowledge01/core'
import type { PublicClient } from 'viem'

type CacheEntry = { check: RevocationCheck }

export class RevocationReader {
  private readonly cache = new Map<string, CacheEntry>()

  constructor(private readonly client: PublicClient) {}

  /**
   * Current revocation state for a collection.
   *
   * On any failure this returns `ok: false`, which callers must treat as
   * "serve nothing". Returning an empty set on error would mean an attacker who
   * can disrupt the RPC re-enables every revoked skill.
   */
  async check(collection: string, now = Date.now()): Promise<RevocationCheck> {
    const cached = this.cache.get(collection)
    if (cached && now - cached.check.checkedAt < REVOCATION_CACHE_MS) {
      return cached.check
    }

    let check: RevocationCheck
    try {
      const record = await getText(this.client, collection, COLLECTION_RECORDS.revoked)
      check = { ok: true, revoked: new Set(parseRevoked(record)), checkedAt: now }
    } catch (e) {
      check = { ok: false, error: (e as Error).message.split('\n')[0] ?? 'read failed', checkedAt: now }
    }

    this.cache.set(collection, { check })
    return check
  }

  /** Drop a cached answer, so the next call re-reads. */
  invalidate(collection: string): void {
    this.cache.delete(collection)
  }
}
