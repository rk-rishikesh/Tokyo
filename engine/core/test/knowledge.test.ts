import { describe, expect, it } from 'vitest'
import {
  ancestors, canonicalJson, changesBetween, createCommit, diffSnapshots, hashObject,
  isAncestor, isValidBranchName, log, mergeBase, missing, newKnowledge, renderConflict,
  renderDiff, renderWhy, revertCommit, shortId, threeWayMerge, validateCommit,
  verifyCommit, why, type Commit, type Snapshot,
} from '../src/knowledge/index.js'

const AGENT = 'alice.eth'
const T = (n: number) => `2026-09-15T00:00:0${n}.000Z`
const mem = (claim: string, o: Partial<Parameters<typeof newKnowledge>[0]> = {}) =>
  newKnowledge({ claim, contributor: AGENT, now: T(0), sources: [{ type: 'conversation', id: 'c1' }], ...o })
const snap = (...ms: ReturnType<typeof mem>[]): Snapshot => Object.fromEntries(ms.map((m) => [m.id, m]))

/** A tiny in-memory store with a lookup, standing in for the repo. */
function store() {
  const m = new Map<string, Commit>()
  return { m, lookup: (id: string) => m.get(id), add: (c: Commit) => (m.set(c.id, c), c) }
}

describe('identity', () => {
  it('canonical json is key-order independent', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }))
  })
  it('same fact in same context gets the same id; different context differs', () => {
    expect(mem('User likes red').id).toBe(mem('user likes red ').id)
    expect(mem('User likes red', { topic: 'cars' }).id).not.toBe(mem('User likes red', { topic: 'clothing' }).id)
  })
  it('commit id is content-derived and verifiable', () => {
    const c = createCommit({ parents: [], branch: 'main', author: AGENT, message: 'init', snapshot: {}, now: T(1) })
    expect(c.id).toHaveLength(64)
    expect(verifyCommit(c)).toBe(true)
    expect(verifyCommit({ ...c, message: 'tampered' })).toBe(false)
    expect(shortId(c.id)).toHaveLength(7)
  })
  it('two agents producing the same history produce the same commit id', () => {
    const a = createCommit({ parents: [], branch: 'main', author: AGENT, message: 'x', snapshot: snap(mem('hi')), now: T(1) })
    const b = createCommit({ parents: [], branch: 'main', author: AGENT, message: 'x', snapshot: snap(mem('hi')), now: T(1) })
    expect(a.id).toBe(b.id)
  })
  it('validates branch names', () => {
    expect(isValidBranchName('main')).toBe(true)
    expect(isValidBranchName('fashion/summer')).toBe(true)
    expect(isValidBranchName('Bad Name')).toBe(false)
    expect(isValidBranchName('a..b')).toBe(false)
  })
})

describe('commits and log (PRD §11 lifecycle)', () => {
  it('records changes against the first parent and walks back as a log', () => {
    const s = store()
    const blue = mem('User likes blue')
    const c1 = s.add(createCommit({ parents: [], branch: 'main', author: AGENT, message: 'likes blue', snapshot: snap(blue), now: T(1) }))
    const dark = mem('User especially likes dark blue')
    const c2 = s.add(createCommit({ parents: [c1], branch: 'main', author: AGENT, message: 'dark blue', snapshot: snap(blue, dark), now: T(2) }))
    expect(c2.changes).toEqual({ added: [dark.id], updated: [], removed: [] })
    expect(log(s.lookup, c2.id).map((c) => c.message)).toEqual(['dark blue', 'likes blue'])
  })
  it('detects an update to an existing memory as updated, not added', () => {
    const blue = mem('User likes blue')
    const changed = { ...blue, claim: 'User prefers green', confidence: 0.9 }
    expect(changesBetween(snap(blue), { [blue.id]: changed })).toEqual({ added: [], updated: [blue.id], removed: [] })
  })
  it('validateCommit rejects a mismatched snapshot key or tampered body', () => {
    const c = createCommit({ parents: [], branch: 'main', author: AGENT, message: 'x', snapshot: snap(mem('a')), now: T(1) })
    expect(() => validateCommit(c)).not.toThrow()
    expect(() => validateCommit({ ...c, snapshot: { wrong: Object.values(c.snapshot)[0]! } })).toThrow(/does not match/)
  })
})

describe('diff (PRD §17)', () => {
  it('reports added, removed and field-level changes', () => {
    const blue = mem('User likes blue')
    const dark = { ...blue, claim: 'User prefers dark blue' }
    const yellow = mem('User dislikes yellow')
    const d = diffSnapshots(snap(blue, yellow), snap(dark, mem('likes textured fabrics', { topic: 'fashion' })))
    expect(d.changed).toBe(1); expect(d.added).toBe(1); expect(d.removed).toBe(1)
    const ch = d.changes.find((c) => c.kind === 'changed')!
    expect(ch.kind === 'changed' && ch.fields.map((f) => f.field)).toEqual(['claim'])
    const text = renderDiff(d)
    expect(text).toContain('- claim: User likes blue')
    expect(text).toContain('+ claim: User prefers dark blue')
    expect(text).toContain('[fashion]')
  })
})

describe('branches and merge (PRD §10, §33)', () => {
  function diverged() {
    const s = store()
    const blue = mem('User likes blue')
    const root = s.add(createCommit({ parents: [], branch: 'main', author: AGENT, message: 'root', snapshot: snap(blue), now: T(1) }))
    const textured = mem('User prefers textured fabrics', { topic: 'fashion' })
    const fashion = s.add(createCommit({ parents: [root], branch: 'fashion', author: AGENT, message: 'textured', snapshot: snap(blue, textured), now: T(2) }))
    const light = mem('User prefers light colours for the room', { topic: 'interior' })
    const interior = s.add(createCommit({ parents: [root], branch: 'interior', author: AGENT, message: 'light', snapshot: snap(blue, light), now: T(3) }))
    return { s, blue, root, fashion, interior, textured, light }
  }
  it('finds the merge base of two branches', () => {
    const { s, root, fashion, interior } = diverged()
    expect(mergeBase(s.lookup, fashion.id, interior.id)).toBe(root.id)
    expect(isAncestor(s.lookup, root.id, fashion.id)).toBe(true)
    expect(isAncestor(s.lookup, fashion.id, interior.id)).toBe(false)
  })
  it('merges independent contexts cleanly — both memories survive', () => {
    const { s, root, fashion, interior, textured, light } = diverged()
    const r = threeWayMerge(root.snapshot, fashion.snapshot, interior.snapshot)
    expect(r.conflicts).toEqual([])
    expect(Object.keys(r.snapshot).sort()).toEqual([root.snapshot[Object.keys(root.snapshot)[0]!]!.id, textured.id, light.id].sort())
    const merge = s.add(createCommit({ parents: [fashion, interior], branch: 'fashion', author: AGENT, message: 'merge interior', snapshot: r.snapshot, now: T(4) }))
    expect(merge.parents).toHaveLength(2)
    expect(ancestors(s.lookup, merge.id).size).toBe(4)
  })
  it('reports, not resolves, the same memory changed differently on both sides', () => {
    const blue = mem('User likes blue')
    const base = snap(blue)
    const ours = { [blue.id]: { ...blue, claim: 'User likes blue clothing' } }
    const theirs = { [blue.id]: { ...blue, claim: 'User hates blue' } }
    const r = threeWayMerge(base, ours, theirs)
    expect(r.conflicts).toHaveLength(1)
    expect(r.conflicts[0]!.reason).toBe('both-changed')
    expect(r.snapshot[blue.id]!.claim).toBe('User likes blue clothing') // ours kept while unresolved
    expect(renderConflict(r.conflicts[0]!)).toContain('CONFLICT')
  })
  it('applies an explicit resolution', () => {
    const blue = mem('User likes blue')
    const ours = { [blue.id]: { ...blue, claim: 'A' } }
    const theirs = { [blue.id]: { ...blue, claim: 'B' } }
    expect(threeWayMerge(snap(blue), ours, theirs, { [blue.id]: 'theirs' }).snapshot[blue.id]!.claim).toBe('B')
    const custom = { ...blue, claim: 'User likes blue clothing but not blue interiors' }
    expect(threeWayMerge(snap(blue), ours, theirs, { [blue.id]: custom }).snapshot[blue.id]!.claim).toBe(custom.claim)
  })
  it('removed on one side vs changed on the other is a conflict', () => {
    const blue = mem('User likes blue')
    const r = threeWayMerge(snap(blue), {}, { [blue.id]: { ...blue, claim: 'x' } })
    expect(r.conflicts[0]!.reason).toBe('removed-vs-changed')
  })
  it('removed on one side and untouched on the other is removed', () => {
    const blue = mem('User likes blue')
    expect(threeWayMerge(snap(blue), {}, snap(blue)).snapshot).toEqual({})
  })
})

describe('revert (PRD §10)', () => {
  it('undoes a commit with a new snapshot and keeps history', () => {
    const s = store()
    const blue = mem('User likes blue')
    const c1 = s.add(createCommit({ parents: [], branch: 'main', author: AGENT, message: 'blue', snapshot: snap(blue), now: T(1) }))
    const dogs = mem('User hates dogs')
    const c2 = s.add(createCommit({ parents: [c1], branch: 'main', author: AGENT, message: 'dogs', snapshot: snap(blue, dogs), now: T(2) }))
    const r = revertCommit(c2, c1.snapshot, c2.snapshot)
    expect(r.conflicts).toEqual([])
    expect(Object.keys(r.snapshot)).toEqual([blue.id])
    const c3 = s.add(createCommit({ parents: [c2], branch: 'main', author: AGENT, message: `Revert ${shortId(c2.id)}`, snapshot: r.snapshot, now: T(3) }))
    expect(log(s.lookup, c3.id)).toHaveLength(3) // nothing destroyed
  })
  it('refuses to remove a memory that changed since', () => {
    const blue = mem('User likes blue')
    const c1 = createCommit({ parents: [], branch: 'main', author: AGENT, message: 'blue', snapshot: snap(blue), now: T(1) })
    const current = { [blue.id]: { ...blue, claim: 'User prefers dark blue' } }
    const r = revertCommit(c1, {}, current)
    expect(r.conflicts[0]!.id).toBe(blue.id)
    expect(r.snapshot[blue.id]).toBeDefined()
  })
})

describe('why (PRD §18)', () => {
  it('finds the introducing and last-changing commits and renders provenance', () => {
    const s = store()
    const blue = mem('User likes blue', { sources: [{ type: 'conversation', id: '3821', excerpt: 'I really like blue' }] })
    const c1 = s.add(createCommit({ parents: [], branch: 'main', author: AGENT, message: 'blue', snapshot: snap(blue), now: T(1) }))
    const dark = { ...blue, claim: 'User prefers dark blue', confidence: 0.94 }
    const c2 = s.add(createCommit({ parents: [c1], branch: 'main', author: AGENT, message: 'dark blue', snapshot: { [blue.id]: dark }, now: T(2) }))
    const p = why(s.lookup, c2.id, blue.id)!
    expect(p.introduced?.id).toBe(c1.id)
    expect(p.lastChanged?.id).toBe(c2.id)
    expect(p.history).toHaveLength(2)
    const text = renderWhy(p)
    expect(text).toContain('conversation 3821')
    expect(text).toContain('94%')
    expect(text).toContain(shortId(c2.id))
  })
})

describe('push planning', () => {
  it('lists unpublished commits parents-first', () => {
    const s = store()
    const a = s.add(createCommit({ parents: [], branch: 'main', author: AGENT, message: 'a', snapshot: {}, now: T(1) }))
    const b = s.add(createCommit({ parents: [a], branch: 'main', author: AGENT, message: 'b', snapshot: {}, now: T(2) }))
    const c = s.add(createCommit({ parents: [b], branch: 'main', author: AGENT, message: 'c', snapshot: {}, now: T(3) }))
    expect(missing(s.lookup, [c.id], new Set([a.id])).map((x) => x.message)).toEqual(['b', 'c'])
  })
})

describe('why across merges', () => {
  it('attributes a merged memory to the branch commit, not the merge', () => {
    const store = new Map<string, Commit>()
    const lookup = (id: string) => store.get(id)
    const put = (c: Commit) => { store.set(c.id, c); return c }
    const a = newKnowledge({ claim: 'on main', contributor: 'x', now: '2026-01-01T00:00:00Z' })
    const b = newKnowledge({ claim: 'on branch', contributor: 'x', now: '2026-01-01T00:00:01Z' })
    const root = put(createCommit({ parents: [], branch: 'main', author: 'x', message: 'root', snapshot: { [a.id]: a }, now: '2026-01-01T00:00:00Z' }))
    const side = put(createCommit({ parents: [root], branch: 'exp', author: 'x', message: 'learn on branch', snapshot: { [a.id]: a, [b.id]: b }, now: '2026-01-01T00:00:01Z' }))
    const main2 = put(createCommit({ parents: [root], branch: 'main', author: 'x', message: 'main moves', snapshot: { [a.id]: { ...a, confidence: 0.5 } }, now: '2026-01-01T00:00:02Z' }))
    const merge = put(createCommit({ parents: [main2, side], branch: 'main', author: 'x', message: 'merge', snapshot: { [a.id]: { ...a, confidence: 0.5 }, [b.id]: b }, now: '2026-01-01T00:00:03Z' }))

    const p = why(lookup, merge.id, b.id)!
    expect(p.introduced?.id).toBe(side.id)
    expect(p.lastChanged?.id).toBe(side.id)
    expect(p.history.map((c) => c.id)).toEqual([side.id])

    const q = why(lookup, merge.id, a.id)!
    expect(q.introduced?.id).toBe(root.id)
    expect(q.lastChanged?.id).toBe(main2.id)
  })
})

describe('policy and automated review (PRD §24, §25)', () => {
  it('derives roles from the policy', async () => {
    const { defaultPolicy, rolesOf, can } = await import('../src/knowledge/index.js')
    const p = { ...defaultPolicy('owner.eth'), reviewers: ['expert.eth'], contributors: ['historian.eth'] as string[] }
    expect(rolesOf(p, 'owner.eth')).toEqual(expect.arrayContaining(['owner', 'reviewer', 'contributor', 'reader']))
    expect(rolesOf(p, 'expert.eth')).toEqual(expect.arrayContaining(['reviewer', 'contributor']))
    expect(rolesOf(p, 'historian.eth')).toEqual(['reader', 'contributor'])
    expect(rolesOf(p, 'stranger.eth')).toEqual(['reader'])
    expect(can(p, 'stranger.eth', 'propose')).toBe(false)
    expect(can({ ...p, contributors: 'anyone' }, 'stranger.eth', 'propose')).toBe(true)
    expect(can(p, 'historian.eth', 'approve')).toBe(false)
    expect(can(p, 'expert.eth', 'merge')).toBe(true)
    expect(can(p, 'expert.eth', 'admin')).toBe(false)
  })

  it('finds contradictions, duplicates, missing sources and unsupported changes', async () => {
    const { reviewChanges } = await import('../src/knowledge/index.js')
    const base = snap(
      mem('India became independent in 1947', { subject: 'Indian Independence', topic: 'independence', reviewers: ['expert.eth'] }),
    )
    const dup = mem('india became independent in 1947.', { subject: 'Indian Independence', topic: 'independence', sources: [] })
    const contra = mem('India became independent in 1948', { subject: 'Indian Independence', topic: 'independence', confidence: 0.4 })
    const findings = reviewChanges(base, { ...base, [dup.id]: dup, [contra.id]: contra })
    const kinds = findings.map((f) => f.kind).sort()
    expect(kinds).toContain('duplicate')
    expect(kinds).toContain('contradiction')
    expect(kinds).toContain('missing-sources')
    expect(kinds).toContain('low-confidence')

    const [only] = Object.values(base)
    const changed = { ...only!, claim: 'India became independent on 15 August 1947' }
    const f2 = reviewChanges(base, { [only!.id]: changed })
    expect(f2.map((f) => f.kind)).toEqual(['unsupported-change'])
    const supported = { ...changed, sources: [...changed.sources, { type: 'book', title: 'Freedom at Midnight' }] }
    expect(reviewChanges(base, { [only!.id]: supported })).toEqual([])
  })
})

describe('sources (five ingestion methods)', () => {
  it('classifies legacy source types and respects an explicit kind', async () => {
    const { sourceKind } = await import('../src/knowledge/index.js')
    expect(sourceKind({ type: 'conversation' })).toBe('human')
    expect(sourceKind({ type: 'book' })).toBe('document')
    expect(sourceKind({ type: 'weather' })).toBe('api')
    expect(sourceKind({ type: 'observation' })).toBe('agent')
    expect(sourceKind({ type: 'import' })).toBe('application')
    expect(sourceKind({ type: 'wikipedia', kind: 'application', name: 'Wikipedia' })).toBe('application')
  })
})
