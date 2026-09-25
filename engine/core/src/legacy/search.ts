/**
 * Local full-text index over collection entries.
 *
 * The index is built in the MCP server from decrypted content and never leaves
 * the machine. Results carry provenance (author, merge block, collection) because
 * the MCP layer is required to return attributed, delimited data rather than
 * bare prose — see `engine/mcp`.
 */
import MiniSearch from 'minisearch'
import type { Entry, Collection } from './collection.js'

/** An entry plus the collection it came from. */
export type IndexedEntry = Entry & { collectionName: string }

export type SearchHit = IndexedEntry & { score: number }

const FIELDS = ['title', 'body', 'tags'] as const

export class CollectionIndex {
  private readonly mini: MiniSearch<IndexedEntry & { key: string }>
  private readonly byKey = new Map<string, IndexedEntry>()

  constructor() {
    this.mini = new MiniSearch({
      idField: 'key',
      fields: [...FIELDS],
      storeFields: ['key'],
      // Tags are an array; MiniSearch needs them flattened to text.
      extractField: (doc, field) =>
        field === 'tags'
          ? (doc.tags ?? []).join(' ')
          : (doc as unknown as Record<string, string>)[field],
      searchOptions: {
        boost: { title: 3, tags: 2 },
        prefix: true,
        fuzzy: 0.2,
      },
    })
  }

  /**
   * Add every entry of a collection.
   *
   * Documents are keyed by `collectionName#entryId` so the same entry id can exist
   * in two different collections without colliding.
   */
  addCollection(collection: Collection): void {
    for (const entry of collection.entries) {
      const indexed: IndexedEntry = { ...entry, collectionName: collection.collection }
      const key = `${collection.collection}#${entry.id}`
      if (this.byKey.has(key)) {
        this.byKey.set(key, indexed)
        this.mini.replace({ ...indexed, key })
      } else {
        this.byKey.set(key, indexed)
        this.mini.add({ ...indexed, key })
      }
    }
  }

  /** Drop every entry belonging to a collection, for reindexing after a change. */
  removeCollection(collectionName: string): void {
    for (const key of [...this.byKey.keys()]) {
      if (key.startsWith(`${collectionName}#`)) {
        this.mini.discard(key)
        this.byKey.delete(key)
      }
    }
  }

  search(query: string, opts: { collection?: string; limit?: number } = {}): SearchHit[] {
    const limit = opts.limit ?? 10
    const results = this.mini.search(query)
    const hits: SearchHit[] = []
    for (const r of results) {
      const entry = this.byKey.get(r.id as string)
      if (!entry) continue
      if (opts.collection && entry.collectionName !== opts.collection) continue
      hits.push({ ...entry, score: r.score })
      if (hits.length >= limit) break
    }
    return hits
  }

  /** Every indexed entry, newest merge first. */
  all(collectionName?: string): IndexedEntry[] {
    return [...this.byKey.values()]
      .filter((e) => !collectionName || e.collectionName === collectionName)
      .sort((a, b) => b.mergedAt - a.mergedAt)
  }

  get size(): number {
    return this.byKey.size
  }
}
