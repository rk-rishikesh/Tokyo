/**
 * Retrieval, behind an interface — the same reasoning as the storage adapter.
 *
 * **Retrieval is deliberately not the hard part here**, because of the shape of
 * the data rather than any shortcut.
 *
 * Ranking engines exist to compress a very large, growing stream of episodic
 * history — everything a user said and did — down to the few thousand tokens
 * that matter. A collection is the opposite shape: it is *curated*, a human wrote
 * each entry, and the product thesis is that it stays fresh, narrow and
 * operational. The seed collection is 36 entries and about 23KB.
 *
 * At that size the right answer is not a better ranker; it is to hand the model
 * the whole corpus and let it read (see `WHOLE_COLLECTION_BUDGET_BYTES` and the
 * `memory_fetch_collection` tool). Compression is a solution to a problem a narrow
 * collection does not have.
 *
 * So: keyword search is the default because it is sufficient at collection scale, and
 * the interface exists so a collection that outgrows that can swap in something
 * stronger without touching the resolution, entitlement or decryption path.
 */
import { CollectionIndex, type SearchHit, type Collection } from '@knowledge01/core'

export interface RetrievalEngine {
  readonly name: string
  /** Replace everything indexed for these collections. */
  index(collections: Collection[]): void
  search(query: string, opts?: { collection?: string; limit?: number }): SearchHit[]
  readonly size: number
}

/**
 * Default engine: an in-memory keyword index.
 *
 * Runs locally, needs no API key, no embedding provider and no vector store —
 * which matters because this process already holds decrypted collection content and
 * every dependency added here is another party in that blast radius.
 */
export class KeywordRetrieval implements RetrievalEngine {
  readonly name = 'minisearch'
  private index_ = new CollectionIndex()

  index(collections: Collection[]): void {
    // Rebuild rather than patch: collections are small, and a stale document that
    // survives a merge is worse than the cost of reindexing.
    this.index_ = new CollectionIndex()
    for (const collection of collections) this.index_.addCollection(collection)
  }

  search(query: string, opts: { collection?: string; limit?: number } = {}): SearchHit[] {
    return this.index_.search(query, opts)
  }

  get size(): number {
    return this.index_.size
  }
}

/**
 * Below this, a whole collection is cheaper to read than to search.
 *
 * ~256KB of JSON is comfortably inside a modern context window, and a curated
 * collection is expected to sit far under it. Above it, search earns its place.
 */
export const WHOLE_COLLECTION_BUDGET_BYTES = 256_000

export function createRetrieval(
  kind: string = process.env.RECALL_RETRIEVAL ?? 'minisearch',
): RetrievalEngine {
  switch (kind) {
    case 'minisearch':
      return new KeywordRetrieval()
    default:
      throw new Error(
        `Unknown RECALL_RETRIEVAL "${kind}". Built in: minisearch. ` +
          'Implement RetrievalEngine to add another.',
      )
  }
}
