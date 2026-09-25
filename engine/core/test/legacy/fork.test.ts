import { describe, expect, it } from 'vitest'
import {
  addLocalEntry,
  diffManifest,
  EMPTY_MANIFEST,
  emptyCollection,
  forkCollection,
  suppress,
  syncUpstream,
  type Collection,
  type Entry,
  type Manifest,
} from '../src/index.js'

const A = '0x1111111111111111111111111111111111111111' as const
const B = '0x2222222222222222222222222222222222222222' as const

const man = (o: Partial<Manifest> = {}): Manifest => ({ ...EMPTY_MANIFEST, ...o })

const entry = (id: string, over: Partial<Entry> = {}): Entry => ({
  id,
  name: id,
  version: '1.0.0',
  body: `# ${id}\n\nbody`,
  manifest: man(),
  tags: [],
  author: A,
  mergedAt: 1,
  origin: 'local',
  ...over,
})

const coll = (name: string, entries: Entry[], over: Partial<Collection> = {}): Collection => ({
  ...emptyCollection(name),
  entries,
  ...over,
})

describe('forking', () => {
  it('marks every inherited entry as upstream', () => {
    const upstream = coll('skills.vercel.eth', [entry('a'), entry('b')])
    const fork = forkCollection({ upstream, upstreamRef: 'bafyUP1', name: 'skills.acme.eth' })

    expect(fork.collection).toBe('skills.acme.eth')
    expect(fork.upstream).toBe('skills.vercel.eth')
    expect(fork.upstreamRef).toBe('bafyUP1')
    expect(fork.entries.every((e) => e.origin === 'upstream')).toBe(true)
  })

  it('starts with no suppressions and no parent of its own', () => {
    const fork = forkCollection({
      upstream: coll('skills.vercel.eth', [entry('a')]),
      upstreamRef: 'bafyUP1',
      name: 'skills.acme.eth',
    })
    expect(fork.suppressed).toEqual([])
    expect(fork.parent).toBeNull()
  })
})

describe('sync — the collision rule', () => {
  it('local wins: a local entry with an upstream id survives, upstream is dropped', () => {
    const upstream = coll('u.eth', [
      entry('shared', { body: 'UPSTREAM VERSION', author: B }),
      entry('other'),
    ])
    let fork = forkCollection({ upstream, upstreamRef: 'r1', name: 'f.eth' })
    fork = addLocalEntry(fork, entry('shared', { body: 'OUR VERSION' }))

    const { collection, report } = syncUpstream({
      fork,
      upstream: coll('u.eth', [
        entry('shared', { body: 'UPSTREAM CHANGED AGAIN', author: B }),
        entry('other'),
      ]),
      upstreamRef: 'r2',
    })

    const shared = collection.entries.find((e) => e.id === 'shared')!
    expect(shared.body).toBe('OUR VERSION')
    expect(shared.origin).toBe('local')
    expect(report.overridden.map((o) => o.id)).toEqual(['shared'])
  })

  it('local entries are always preserved across sync', () => {
    let fork = forkCollection({
      upstream: coll('u.eth', [entry('a')]),
      upstreamRef: 'r1',
      name: 'f.eth',
    })
    fork = addLocalEntry(fork, entry('ours-only', { body: 'private' }))

    const { collection } = syncUpstream({
      fork,
      // upstream dropped 'a' entirely and added something new
      upstream: coll('u.eth', [entry('brand-new')]),
      upstreamRef: 'r2',
    })

    expect(collection.entries.find((e) => e.id === 'ours-only')?.body).toBe('private')
    expect(collection.entries.find((e) => e.id === 'brand-new')?.origin).toBe('upstream')
    expect(collection.entries.find((e) => e.id === 'a')).toBeUndefined()
  })

  it('is a no-op when upstream has not moved', () => {
    const fork = forkCollection({
      upstream: coll('u.eth', [entry('a')]),
      upstreamRef: 'r1',
      name: 'f.eth',
    })
    const { report, collection } = syncUpstream({
      fork,
      upstream: coll('u.eth', [entry('a'), entry('b')]),
      upstreamRef: 'r1',
    })
    expect(report.noop).toBe(true)
    expect(collection.entries).toHaveLength(1)
  })
})

describe('sync — suppressions', () => {
  it('a suppressed upstream id stays absent across three syncs', () => {
    let fork = forkCollection({
      upstream: coll('u.eth', [entry('keep'), entry('unwanted')]),
      upstreamRef: 'r0',
      name: 'f.eth',
    })
    fork = suppress(fork, 'unwanted')
    expect(fork.entries.find((e) => e.id === 'unwanted')).toBeUndefined()

    for (const ref of ['r1', 'r2', 'r3']) {
      const { collection, report } = syncUpstream({
        fork,
        upstream: coll('u.eth', [entry('keep'), entry('unwanted', { version: `9.${ref}.0` })]),
        upstreamRef: ref,
      })
      fork = collection
      expect(fork.entries.find((e) => e.id === 'unwanted')).toBeUndefined()
      expect(report.suppressed.map((e) => e.id)).toEqual(['unwanted'])
    }
  })

  it('a removed upstream entry is not reported as removed when it was suppressed', () => {
    let fork = forkCollection({
      upstream: coll('u.eth', [entry('gone')]),
      upstreamRef: 'r0',
      name: 'f.eth',
    })
    fork = suppress(fork, 'gone')
    const { report } = syncUpstream({ fork, upstream: coll('u.eth', []), upstreamRef: 'r1' })
    expect(report.removed).toEqual([])
  })
})

describe('sync — reporting', () => {
  it('reports added, removed and changed on the inherited half', () => {
    const fork = forkCollection({
      upstream: coll('u.eth', [entry('keep'), entry('drop'), entry('edit')]),
      upstreamRef: 'r1',
      name: 'f.eth',
    })
    const { report } = syncUpstream({
      fork,
      upstream: coll('u.eth', [
        entry('keep'),
        entry('edit', { body: 'changed', version: '2.0.0' }),
        entry('fresh'),
      ]),
      upstreamRef: 'r2',
    })
    expect(report.added.map((e) => e.id)).toEqual(['fresh'])
    expect(report.removed.map((e) => e.id)).toEqual(['drop'])
    expect(report.changed.map((c) => c.id)).toEqual(['edit'])
  })

  it('flags an upstream entry the fork carries that upstream has revoked', () => {
    const fork = forkCollection({
      upstream: coll('u.eth', [entry('bad'), entry('good')]),
      upstreamRef: 'r1',
      name: 'f.eth',
    })
    const { report } = syncUpstream({
      fork,
      upstream: coll('u.eth', [entry('bad'), entry('good')]),
      upstreamRef: 'r2',
      upstreamRevoked: ['bad'],
    })
    expect(report.revokedUpstream.map((e) => e.id)).toEqual(['bad'])
  })
})

describe('manifest diffing', () => {
  it('detects an added write path', () => {
    const d = diffManifest(man({ writes: [] }), man({ writes: ['src/**'] }))
    expect(d.widened).toBe(true)
    expect(d.added).toEqual([{ field: 'writes', value: 'src/**' }])
  })

  it('detects an added endpoint', () => {
    const d = diffManifest(man(), man({ endpoints: ['https://evil.example'] }))
    expect(d.widened).toBe(true)
    expect(d.added[0]!.field).toBe('endpoints')
  })

  it('detects an added tool', () => {
    const d = diffManifest(man({ tools: ['read'] }), man({ tools: ['read', 'bash'] }))
    expect(d.widened).toBe(true)
    expect(d.added).toEqual([{ field: 'tools', value: 'bash' }])
  })

  it('a narrowed manifest is not a widening', () => {
    const d = diffManifest(man({ writes: ['src/**'] }), man({ writes: [] }))
    expect(d.widened).toBe(false)
    expect(d.removed).toHaveLength(1)
  })

  it('flags a sync whose upstream change quietly widens permissions', () => {
    const fork = forkCollection({
      upstream: coll('u.eth', [entry('skill', { manifest: man({ reads: ['src/**'] }) })]),
      upstreamRef: 'r1',
      name: 'f.eth',
    })
    const { report } = syncUpstream({
      fork,
      upstream: coll('u.eth', [
        entry('skill', { manifest: man({ reads: ['src/**'], writes: ['/**'] }) }),
      ]),
      upstreamRef: 'r2',
    })
    expect(report.anyManifestWidened).toBe(true)
    expect(report.changed[0]!.manifest.added).toEqual([{ field: 'writes', value: '/**' }])
  })
})
