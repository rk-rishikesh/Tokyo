import { describe, expect, it } from 'vitest'
import {
  checkStale,
  diffEntries,
  emptyCollection,
  isFastForward,
  mergeCollection,
  parseCollection,
  serialiseCollection,
  slugify,
  CollectionValidationError,
  validateCollection,
  withEntry,
  type Entry,
  type Collection,
  EMPTY_MANIFEST,
} from '../src/collection.js'

const A = '0x1111111111111111111111111111111111111111' as const
const B = '0x2222222222222222222222222222222222222222' as const

const entry = (id: string, over: Partial<Entry> = {}): Entry => ({
  id,
  name: `Skill ${id}`,
  version: '1.0.0',
  body: `# ${id}\n\nBody of ${id}`,
  manifest: EMPTY_MANIFEST,
  tags: ['tag'],
  author: A,
  mergedAt: 100,
  origin: 'local',
  ...over,
})

const collectionOf = (entries: Entry[], over: Partial<Collection> = {}): Collection => ({
  ...emptyCollection('exploits.auditor.eth'),
  entries,
  ...over,
})

describe('validation', () => {
  it('accepts a well-formed collection', () => {
    expect(() => validateCollection(collectionOf([entry('reentrancy-in-vault')]))).not.toThrow()
  })

  it('rejects a non-kebab-case id, because id is the merge key', () => {
    expect(() => validateCollection(collectionOf([entry('Not Kebab')]))).toThrow(CollectionValidationError)
  })

  it('rejects duplicate ids', () => {
    expect(() => validateCollection(collectionOf([entry('dup'), entry('dup')]))).toThrow(/duplicate entry id/)
  })

  it('rejects a bad author address', () => {
    expect(() => validateCollection(collectionOf([entry('x', { author: '0xnope' as never })]))).toThrow(
      CollectionValidationError,
    )
  })

  it('rejects the wrong schema', () => {
    expect(() => validateCollection(collectionOf([], { schema: 'other/1' as never }))).toThrow(/schema must be/)
  })

  it('round-trips through serialise and parse', () => {
    const s = collectionOf([entry('b'), entry('a')])
    const parsed = parseCollection(serialiseCollection(s))
    expect(parsed.entries.map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('reports JSON syntax errors rather than throwing raw', () => {
    expect(() => parseCollection(new TextEncoder().encode('{oops'))).toThrow(CollectionValidationError)
  })
})

describe('fast-forward check', () => {
  it('is a fast-forward when the parent matches the current ref', () => {
    expect(isFastForward('bafyA', 'bafyA')).toBe(true)
  })

  it('is stale when the collection has moved on', () => {
    expect(isFastForward('bafyA', 'bafyB')).toBe(false)
    expect(checkStale('bafyA', 'bafyB').stale).toBe(true)
  })

  it('treats a first proposal against an empty collection as a fast-forward', () => {
    expect(isFastForward(null, null)).toBe(true)
  })

  it('is stale when a proposal claims no parent but the collection has content', () => {
    expect(checkStale(null, 'bafyA').stale).toBe(true)
  })

  it('explains why it is stale', () => {
    expect(checkStale('bafyA', 'bafyB').reason).toContain('bafyA')
  })
})

describe('merge', () => {
  it('unions entries with different ids', () => {
    const current = collectionOf([entry('a')])
    const proposal = collectionOf([entry('a'), entry('b', { author: B })])
    const { collection, conflicts } = mergeCollection(current, proposal)
    expect(collection.entries.map((e) => e.id)).toEqual(['a', 'b'])
    expect(conflicts).toHaveLength(0)
  })

  it('flags the same id edited on both sides as a conflict', () => {
    const base = collectionOf([entry('a')])
    const current = collectionOf([entry('a', { name: 'ours' })])
    const proposal = collectionOf([entry('a', { name: 'theirs', author: B })])
    const { conflicts } = mergeCollection(current, proposal, base)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]!.id).toBe('a')
    expect(conflicts[0]!.ours.name).toBe('ours')
    expect(conflicts[0]!.theirs.name).toBe('theirs')
  })

  it('takes their edit when only they changed it', () => {
    const base = collectionOf([entry('a')])
    const current = collectionOf([entry('a')])
    const proposal = collectionOf([entry('a', { name: 'theirs', author: B })])
    const { collection, conflicts } = mergeCollection(current, proposal, base)
    expect(conflicts).toHaveLength(0)
    expect(collection.entries[0]!.name).toBe('theirs')
  })

  it('keeps ours when only we changed it', () => {
    const base = collectionOf([entry('a')])
    const current = collectionOf([entry('a', { name: 'ours' })])
    const proposal = collectionOf([entry('a')])
    const { collection, conflicts } = mergeCollection(current, proposal, base)
    expect(conflicts).toHaveLength(0)
    expect(collection.entries[0]!.name).toBe('ours')
  })

  it('cannot conflict on a fast-forward merge', () => {
    const current = collectionOf([entry('a')])
    const proposal = collectionOf([entry('a', { name: 'edited', author: B })])
    // base === current is what a fast-forward means
    const { conflicts, collection } = mergeCollection(current, proposal)
    expect(conflicts).toHaveLength(0)
    expect(collection.entries[0]!.name).toBe('edited')
  })

  it('preserves the id as the merge key rather than matching on title', () => {
    const current = collectionOf([entry('a', { name: 'same name' })])
    const proposal = collectionOf([entry('b', { name: 'same name', author: B })])
    const { collection } = mergeCollection(current, proposal)
    expect(collection.entries.map((e) => e.id)).toEqual(['a', 'b'])
  })
})

describe('diff', () => {
  it('classifies added, removed and modified by id', () => {
    const before = collectionOf([entry('keep'), entry('drop'), entry('edit')])
    const after = collectionOf([entry('keep'), entry('edit', { name: 'new' }), entry('new')])
    const changes = diffEntries(before, after)
    expect(changes.find((c) => c.id === 'new')?.kind).toBe('added')
    expect(changes.find((c) => c.id === 'drop')?.kind).toBe('removed')
    expect(changes.find((c) => c.id === 'edit')?.kind).toBe('modified')
    expect(changes.find((c) => c.id === 'keep')).toBeUndefined()
  })
})

describe('helpers', () => {
  it('withEntry replaces by id rather than appending a duplicate', () => {
    const s = withEntry(collectionOf([entry('a')]), entry('a', { name: 'replaced' }))
    expect(s.entries).toHaveLength(1)
    expect(s.entries[0]!.name).toBe('replaced')
  })

  it('slugify produces a valid entry id', () => {
    expect(slugify('Reentrancy in Vault.withdraw()!')).toBe('reentrancy-in-vault-withdraw')
  })
})
