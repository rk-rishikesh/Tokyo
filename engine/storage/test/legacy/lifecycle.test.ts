/**
 * The collection lifecycle end to end, without a chain: publish, subscribe, propose,
 * merge, pin, lapse.
 *
 * This covers the parts of M1/M4/M5 that are pure logic. What it cannot cover is
 * the on-chain authorisation itself — that a contributor writing another
 * contributor's proposal key reverts — which needs Sepolia and is asserted by
 * the integration checks listed in the README.
 */
import { describe, expect, it } from 'vitest'
import { generatePrivateKey } from 'viem/accounts'
import {
  checkStale,
  diffEntries,
  emptyCollection,
  EMPTY_MANIFEST,
  generateContentKey,
  mergeCollection,
  parseCollection,
  publicKeyFromPrivate,
  serialiseCollection,
  CollectionIndex,
  withEntry,
  type Entry,
  type Collection,
} from '@knowledge01/core'
import { MemoryAdapter } from '../src/memory.js'

const PUBLISHER = '0x1111111111111111111111111111111111111111' as const
const CONTRIBUTOR = '0x2222222222222222222222222222222222222222' as const

const entry = (id: string, over: Partial<Entry> = {}): Entry => ({
  id,
  name: id,
  version: '1.0.0',
  body: `# ${id}\n\nbody`,
  manifest: EMPTY_MANIFEST,
  tags: [],
  author: PUBLISHER,
  mergedAt: 1,
  origin: 'local',
  ...over,
})

describe('collection lifecycle', () => {
  it('publishes, subscribes, contributes and merges', async () => {
    const storage = new MemoryAdapter()
    const contentKey = generateContentKey()
    const name = 'exploits.auditor.eth'
    const ctx = { collection: name, contentKey }

    // --- publish v1 ---
    let collection: Collection = { ...emptyCollection(name), entries: [entry('reentrancy')] }
    const v1 = await storage.put(serialiseCollection(collection), ctx)
    const contenthashV1 = storage.toContenthash(v1)
    expect(storage.fromContenthash(contenthashV1).ref).toBe(v1.ref)

    // --- a subscriber gets the content key wrapped to them ---
    const subscriber = generatePrivateKey()
    const { wrapped } = await storage.grant(v1, [publicKeyFromPrivate(subscriber)], ctx)
    const readBack = parseCollection(
      await storage.get(v1, { wrappedKey: wrapped[0]!.wrappedKey, privateKey: subscriber }),
    )
    expect(readBack.entries.map((e) => e.id)).toEqual(['reentrancy'])

    // --- a contributor proposes against v1 ---
    const proposal = withEntry(readBack, entry('oracle-manipulation', { author: CONTRIBUTOR }))
    const parentRef = v1.ref

    // --- fast-forward check passes while the collection has not moved ---
    expect(checkStale(parentRef, v1.ref).stale).toBe(false)

    // --- maintainer merges ---
    const merged = mergeCollection(readBack, proposal)
    expect(merged.conflicts).toHaveLength(0)
    expect(merged.changes.map((c) => `${c.kind}:${c.id}`)).toEqual(['added:oracle-manipulation'])

    collection = { ...merged.collection, parent: parentRef }
    const v2 = await storage.put(serialiseCollection(collection), ctx)
    expect(v2.ref).not.toBe(v1.ref)

    // --- a proposal written against v1 is now stale ---
    const stale = checkStale(parentRef, v2.ref)
    expect(stale.stale).toBe(true)
    expect(stale.reason).toContain(parentRef)

    // --- the subscriber follows head and sees both entries ---
    const head = parseCollection(
      await storage.get(v2, { wrappedKey: wrapped[0]!.wrappedKey, privateKey: subscriber }),
    )
    expect(head.entries.map((e) => e.id).sort()).toEqual(['oracle-manipulation', 'reentrancy'])
    expect(head.parent).toBe(v1.ref)

    // --- a pinned subscriber still reads v1 ---
    const pinned = parseCollection(
      await storage.get(v1, { wrappedKey: wrapped[0]!.wrappedKey, privateKey: subscriber }),
    )
    expect(pinned.entries.map((e) => e.id)).toEqual(['reentrancy'])
  })

  it('a lapsed subscriber cannot read the version published after their re-key', async () => {
    const storage = new MemoryAdapter()
    const contentKey = generateContentKey()
    const ctx = { collection: 's.eth', contentKey }

    const kept = generatePrivateKey()
    const lapsed = generatePrivateKey()
    const keptPub = publicKeyFromPrivate(kept)
    const lapsedPub = publicKeyFromPrivate(lapsed)

    const v1 = await storage.put(serialiseCollection({ ...emptyCollection('s.eth'), entries: [entry('a')] }), ctx)
    const granted = await storage.grant(v1, [keptPub, lapsedPub], ctx)
    const lapsedKey = granted.wrapped.find((w) => w.pubkey === lapsedPub)!.wrappedKey

    // The subscription expires on chain; the publisher re-keys on next publish.
    const revoked = await storage.revoke(v1, [lapsedPub], { ...ctx, remaining: [keptPub, lapsedPub] })

    // No revocation transaction was needed — the old key simply stops working.
    await expect(
      storage.get(revoked.ref, { wrappedKey: lapsedKey, privateKey: lapsed }),
    ).rejects.toThrow(/re-keyed/)

    const keptKey = revoked.wrapped.find((w) => w.pubkey === keptPub)!.wrappedKey
    expect(parseCollection(await storage.get(revoked.ref, { wrappedKey: keptKey, privateKey: kept })).entries).toHaveLength(1)
  })

  it('indexes merged entries with their author and merge block intact', async () => {
    const collection: Collection = {
      ...emptyCollection('exploits.auditor.eth'),
      entries: [
        entry('oracle-manipulation', {
          name: 'Spot price read from AMM reserves',
          body: 'A flash loan can set any price for one transaction.',
          tags: ['oracles'],
          author: CONTRIBUTOR,
          mergedAt: 8_421_337,
        }),
      ],
    }
    const index = new CollectionIndex()
    index.addCollection(collection)

    const [hit] = index.search('flash loan price')
    expect(hit).toBeDefined()
    expect(hit!.author).toBe(CONTRIBUTOR)
    expect(hit!.mergedAt).toBe(8_421_337)
    expect(hit!.collectionName).toBe('exploits.auditor.eth')
  })

  it('detects a conflict when two proposals edit the same entry id', async () => {
    const base: Collection = { ...emptyCollection('s.eth'), entries: [entry('shared')] }
    const ours: Collection = { ...emptyCollection('s.eth'), entries: [entry('shared', { body: 'ours' })] }
    const theirs: Collection = { ...emptyCollection('s.eth'), entries: [entry('shared', { body: 'theirs', author: CONTRIBUTOR })] }

    const { conflicts } = mergeCollection(ours, theirs, base)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]!.ours.body).toBe('ours')
    expect(conflicts[0]!.theirs.body).toBe('theirs')
  })

  it('produces a diff a maintainer can review before merging', () => {
    const before: Collection = { ...emptyCollection('s.eth'), entries: [entry('keep'), entry('edit')] }
    const after: Collection = {
      ...emptyCollection('s.eth'),
      entries: [entry('keep'), entry('edit', { body: 'revised' }), entry('new', { author: CONTRIBUTOR })],
    }
    const changes = diffEntries(before, after)
    expect(changes.map((c) => `${c.kind}:${c.id}`)).toEqual(['modified:edit', 'added:new'])
  })
})
