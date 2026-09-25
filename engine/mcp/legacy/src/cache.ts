/**
 * Local cache at `~/.recall/cache.json` (PRD §8).
 *
 * Holds per-collection: the last ref seen, the decrypted entries, the pin state, and
 * the content key. **Invalidated on `contenthash` change** — the chain is the
 * source of truth for what the current version is, and a cache that outlives a
 * contenthash change is how a subscriber silently keeps reading a stale collection.
 *
 * Content keys live here because the MCP server holds key custody: the agent
 * only ever sees decrypted content as tool output, never a key.
 */
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { Collection } from '@knowledge01/core'
import type { Hex } from 'viem'

export type PinState =
  | { kind: 'head' }
  /** Frozen at a specific ref — the subscriber opted out of updates. */
  | { kind: 'pinned'; ref: string }

export type CachedCollection = {
  name: string
  /** Ref the cached entries were decrypted from. */
  ref: string | null
  /** `contenthash` the ref came from. Cache is invalid if this changes. */
  contenthash: Hex | null
  collection: Collection | null
  pin: PinState
  /** Hex-encoded collection content key, held by the server on the user's behalf. */
  contentKey: Hex | null
  updatedAt: number
}

export type CacheShape = {
  version: 1
  collections: Record<string, CachedCollection>
}

const EMPTY: CacheShape = { version: 1, collections: {} }

export function cacheDir(): string {
  const configured = process.env.RECALL_CACHE_DIR ?? '~/.recall'
  return configured.startsWith('~')
    ? join(homedir(), configured.slice(1))
    : resolve(configured)
}

export function cachePath(): string {
  return join(cacheDir(), 'cache.json')
}

export class Cache {
  private data: CacheShape

  constructor(private readonly path: string = cachePath()) {
    this.data = this.read()
  }

  private read(): CacheShape {
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as CacheShape
      if (parsed.version !== 1) return { ...EMPTY }
      return parsed
    } catch {
      // Missing or corrupt: start clean rather than fail to boot. Everything in
      // here is reconstructible from the chain and storage.
      return { ...EMPTY }
    }
  }

  /** Write atomically, so a crash mid-write cannot corrupt the cache. */
  private flush(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 })
    renameSync(tmp, this.path)
  }

  get(name: string): CachedCollection | undefined {
    return this.data.collections[name]
  }

  list(): CachedCollection[] {
    return Object.values(this.data.collections)
  }

  /**
   * Return the cached collection only if it was decrypted from `contenthash`.
   *
   * A mismatch means the maintainer moved the pointer; the cached entries
   * describe a version that is no longer current.
   */
  valid(name: string, contenthash: Hex | null): CachedCollection | undefined {
    const cached = this.data.collections[name]
    if (!cached || !cached.collection) return undefined
    if (cached.contenthash !== contenthash) return undefined
    return cached
  }

  put(entry: CachedCollection): void {
    this.data.collections[entry.name] = { ...entry, updatedAt: Math.floor(Date.now() / 1000) }
    this.flush()
  }

  update(name: string, patch: Partial<CachedCollection>): CachedCollection {
    const existing: CachedCollection = this.data.collections[name] ?? {
      name,
      ref: null,
      contenthash: null,
      collection: null,
      pin: { kind: 'head' },
      contentKey: null,
      updatedAt: 0,
    }
    const next = { ...existing, ...patch, name, updatedAt: Math.floor(Date.now() / 1000) }
    this.data.collections[name] = next
    this.flush()
    return next
  }

  /** Drop decrypted content for a collection, keeping the key and pin state. */
  invalidate(name: string): void {
    const existing = this.data.collections[name]
    if (!existing) return
    this.data.collections[name] = { ...existing, collection: null, ref: null, contenthash: null }
    this.flush()
  }

  remove(name: string): void {
    delete this.data.collections[name]
    this.flush()
  }
}
