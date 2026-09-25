import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Hex } from 'viem'
import { MemoryAdapter } from '@recall/storage'
import { generateContentKey, renderConflict, renderWhy, shortId } from '@recall/core'
import { Remote, Repository, RepoStore, type Pointer } from '../src/index.js'

/** A pointer that lives in a variable — the chain, without the chain. */
class FakePointer implements Pointer {
  value: Hex | null = null
  writes = 0
  async read() { return this.value }
  async write(ch: Hex) { this.value = ch; this.writes++; return `tx-${this.writes}` }
}

let root: string
const KEY = `0x${Buffer.from(generateContentKey()).toString('hex')}`
const open = (ns: string) => new Repository(RepoStore.open(join(root, ns)))
const init = (ns: string, identity = 'alice.eth') =>
  new Repository(RepoStore.init(join(root, ns), { namespace: ns, identity, defaultBranch: 'main', contentKey: KEY }))

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'memrepo-')) })
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('the flagship demo, locally (PRD §38)', () => {
  it('runs steps 1–9 end to end', () => {
    // 1. init
    const repo = init('memory.alice.eth')
    expect(repo.branch).toBe('main')
    expect(repo.status().head).toBeUndefined()

    // 2. "I like blue" → commit 001
    const c1 = repo.remember({ claim: 'User likes blue', type: 'preference', sources: [{ type: 'conversation', id: '3821', excerpt: 'I really like blue' }] })
    expect(repo.log().map((c) => c.message)).toEqual([c1.commit.message])

    // 3. "I prefer dark blue clothing" → commit 002
    const c2 = repo.remember({ claim: 'User prefers dark blue clothing', type: 'preference', confidence: 0.94 })
    expect(repo.log()).toHaveLength(2)

    // 4. branch fashion; 5. learn on it → commit 003
    repo.checkout('fashion', { create: true })
    const c3 = repo.remember({ claim: 'User prefers textured fabrics', topic: 'fashion' })
    expect(repo.log()).toHaveLength(3)
    expect(repo.log('main')).toHaveLength(2)

    // 6. branch interior from main; learn → commit 004
    repo.checkout('main')
    repo.checkout('interior', { create: true })
    const c4 = repo.remember({ claim: 'User prefers light colours for the room', topic: 'interior' })

    // 7. graph shape: both branches share c2 as parent
    expect(c3.commit.parents).toEqual([c2.commit.id])
    expect(c4.commit.parents).toEqual([c2.commit.id])
    expect(Object.keys(repo.branches()).sort()).toEqual(['fashion', 'interior', 'main'])

    // 8. diff main..fashion
    const d = repo.diff('main', 'fashion')
    expect(d.added).toBe(1)
    expect(d.changes[0]!.kind === 'added' && d.changes[0]!.after.topic).toBe('fashion')

    // 9. why does the agent know "likes blue"?
    const p = repo.why(c1.knowledge.id, 'main')!
    expect(p.introduced?.id).toBe(c1.commit.id)
    expect(renderWhy(p)).toContain('conversation 3821')
  })
})

describe('working snapshot and commits', () => {
  it('remember collapses the same fact in the same context onto one memory', () => {
    const repo = init('a.eth')
    const first = repo.remember({ claim: 'User likes blue' })
    const again = repo.add({ claim: 'user likes blue', confidence: 0.99 })
    expect(again.id).toBe(first.knowledge.id)
    expect(again.created_at).toBe(first.knowledge.created_at)
    expect(again.updated_at).toBeDefined()
    expect(repo.status().staged.changed).toBe(1)
  })
  it('refuses an empty commit and refuses checkout with uncommitted changes', () => {
    const repo = init('a.eth')
    expect(() => repo.commit('nothing')).toThrow(/nothing to commit/)
    expect(() => repo.createBranch('b')).toThrow(/no commits yet/)
    repo.remember({ claim: 'first' })
    repo.createBranch('b')
    repo.add({ claim: 'x' })
    expect(() => repo.checkout('b')).toThrow(/uncommitted/)
  })
  it('forget removes from the index but the memory stays in history', () => {
    const repo = init('a.eth')
    const { knowledge: memory } = repo.remember({ claim: 'User hates dogs' })
    expect(repo.remove(memory.id)).toBe(true)
    const c = repo.commit('forget dogs')
    expect(c.changes.removed).toEqual([memory.id])
    expect(repo.log()[1]!.snapshot[memory.id]).toBeDefined()
  })
  it('resolves short ids and branch names', () => {
    const repo = init('a.eth')
    const { commit } = repo.remember({ claim: 'x' })
    expect(repo.resolve(shortId(commit.id)).id).toBe(commit.id)
    expect(repo.resolve('main').id).toBe(commit.id)
    expect(() => repo.resolve('nope')).toThrow(/unknown ref/)
  })
})

describe('merge', () => {
  it('fast-forwards when behind and three-way merges independent contexts', () => {
    const repo = init('a.eth')
    repo.remember({ claim: 'User likes blue' })
    repo.checkout('fashion', { create: true })
    repo.remember({ claim: 'textured fabrics', topic: 'fashion' })
    repo.checkout('main')
    // main is behind fashion → fast-forward
    const ff = repo.merge('fashion')
    expect(ff.fastForward).toBe(true)
    expect(Object.keys(repo.headSnapshot())).toHaveLength(2)

    repo.checkout('interior', { create: true })
    repo.remember({ claim: 'light colours', topic: 'interior' })
    repo.checkout('fashion')
    repo.remember({ claim: 'no polyester', topic: 'fashion' })
    // both moved → real merge, no conflicts (different ids)
    const m = repo.merge('interior')
    expect(m.fastForward).toBe(false)
    expect(m.result.conflicts).toEqual([])
    expect(m.commit?.parents).toHaveLength(2)
    expect(Object.keys(repo.headSnapshot())).toHaveLength(4)
  })
  it('surfaces a conflict and completes with a resolution', () => {
    const repo = init('a.eth')
    const { knowledge: memory } = repo.remember({ claim: 'User likes blue' })
    repo.checkout('other', { create: true })
    repo.update(memory.id, { claim: 'User hates blue' }); repo.commit('hates')
    repo.checkout('main')
    repo.update(memory.id, { claim: 'User likes blue clothing' }); repo.commit('clothing')

    const blocked = repo.merge('other')
    expect(blocked.commit).toBeUndefined()
    expect(blocked.result.conflicts[0]!.reason).toBe('both-changed')
    expect(renderConflict(blocked.result.conflicts[0]!)).toContain('hates blue')
    // branch untouched while unresolved
    expect(repo.headCommit()!.message).toBe('clothing')

    const resolved = repo.merge('other', { resolutions: { [memory.id]: { ...memory, claim: 'User likes blue clothing but dislikes blue interiors' } } })
    expect(resolved.commit).toBeDefined()
    expect(repo.headSnapshot()[memory.id]!.claim).toContain('dislikes blue interiors')
  })
})

describe('revert', () => {
  it('creates an inverse commit and preserves history', () => {
    const repo = init('a.eth')
    repo.remember({ claim: 'User likes blue' })
    const bad = repo.remember({ claim: 'User hates dogs' })
    const r = repo.revert(shortId(bad.commit.id))
    expect(r.conflicts).toEqual([])
    expect(r.commit!.message).toMatch(/^Revert/)
    expect(repo.headSnapshot()[bad.knowledge.id]).toBeUndefined()
    expect(repo.log()).toHaveLength(3)
  })
})

describe('push and pull (PRD §38 step 10 — a second agent reads the namespace)', () => {
  it('publishes with one pointer move, and a second repo pulls the whole graph', async () => {
    const storage = new MemoryAdapter()
    const pointer = new FakePointer()

    const alice = init('memory.alice.eth', 'alice.eth')
    alice.remember({ claim: 'User likes blue' })
    alice.checkout('fashion', { create: true })
    alice.remember({ claim: 'textured fabrics', topic: 'fashion' })
    alice.checkout('main')
    alice.remember({ claim: 'User dislikes yellow' })

    const push = await new Remote(alice, storage, pointer).push()
    expect(push.pushed).toHaveLength(3)
    expect(pointer.writes).toBe(1) // three commits, two branches, ONE transaction
    expect(alice.status().unpushed).toBe(0)

    // Second contributor: same namespace + key, empty repo.
    const bob = new Repository(RepoStore.init(join(root, 'bob'), { namespace: 'memory.alice.eth', identity: 'travel-agent.eth', defaultBranch: 'main', contentKey: KEY }))
    const pull = await new Remote(bob, storage, pointer).pull()
    expect(pull.fetched).toHaveLength(3)
    expect(pull.created.sort()).toEqual(['fashion', 'main'])
    expect(bob.log('main').map((c) => c.message)).toEqual(alice.log('main').map((c) => c.message))
    expect(Object.keys(bob.headSnapshot())).toHaveLength(2)
    expect(Object.keys(bob.headSnapshot('fashion'))).toHaveLength(2)
  })

  it('a second push with no changes sends no transaction', async () => {
    const storage = new MemoryAdapter(); const pointer = new FakePointer()
    const repo = init('a.eth'); repo.remember({ claim: 'x' })
    const remote = new Remote(repo, storage, pointer)
    await remote.push()
    const again = await remote.push()
    expect(again.noop).toBe(true)
    expect(pointer.writes).toBe(1)
  })

  it('pull fast-forwards a behind branch and reports a diverged one', async () => {
    const storage = new MemoryAdapter(); const pointer = new FakePointer()
    const a = init('a', 'a.eth'); a.setPolicy({ reviewers: ['b.eth'] }); a.remember({ claim: 'one' })
    await new Remote(a, storage, pointer).push()
    const b = new Repository(RepoStore.init(join(root, 'b'), { namespace: 'a', identity: 'b.eth', defaultBranch: 'main', contentKey: KEY }))
    await new Remote(b, storage, pointer).pull()
    // a moves ahead; b pulls → fast-forward
    a.remember({ claim: 'two' }); await new Remote(a, storage, pointer).push()
    expect((await new Remote(b, storage, pointer).pull()).fastForwarded).toEqual(['main'])
    // both move → diverged, b's branch not touched
    a.remember({ claim: 'three' }); await new Remote(a, storage, pointer).push()
    b.remember({ claim: 'b-only' })
    const r = await new Remote(b, storage, pointer).pull()
    expect(r.diverged).toEqual(['main'])
    expect(b.headCommit()!.message).toContain('b-only')
    expect(r.fetched).toHaveLength(1) // 'three' was fetched, just not adopted
  })

  it('a wrong content key cannot read the published graph', async () => {
    const storage = new MemoryAdapter(); const pointer = new FakePointer()
    const a = init('a'); a.remember({ claim: 'secret' })
    await new Remote(a, storage, pointer).push()
    const other = `0x${Buffer.from(generateContentKey()).toString('hex')}`
    const eve = new Repository(RepoStore.init(join(root, 'eve'), { namespace: 'a', identity: 'eve.eth', defaultBranch: 'main', contentKey: other }))
    await expect(new Remote(eve, storage, pointer).pull()).rejects.toThrow()
  })
})

describe('observation pipeline (SDK)', () => {
  it('observe → proposal → commit, threshold and supersession', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'memory-sdk-'))
    process.env.RECALL_CACHE_DIR = dir
    const { Memory } = await import('../src/sdk.js')
    const memory = Memory.for('alice.eth', { agent: 'shopping-agent', threshold: 0.8 })
    expect(memory.name).toBe('alice.eth')

    const low = memory.observe({ observation: 'User glanced at Adidas', topic: 'shopping', confidence: 0.4 })
    expect(low.proposal.action).toBe('below-threshold')
    expect(low.commit).toBeUndefined()

    const first = memory.observe({ observation: 'User prefers Nike running shoes', topic: 'shopping', confidence: 0.87 })
    expect(first.proposal.action).toBe('add')
    expect(first.commit?.author).toBe('shopping-agent')

    const again = memory.observe({ observation: 'User prefers Nike running shoes', topic: 'shopping', confidence: 0.95 })
    expect(again.proposal.action).toBe('known')
    expect(again.commit?.message).toMatch(/^reinforce/)

    const revised = memory.observe({ observation: 'User prefers Nike Pegasus running shoes', topic: 'shopping', confidence: 0.96 })
    expect(revised.proposal.action).toBe('update')
    expect(memory.search('pegasus')).toHaveLength(1)
    expect(memory.all()).toHaveLength(1)

    const weak = memory.observe({ observation: 'User prefers Adidas running shoes', topic: 'shopping', confidence: 0.85 })
    expect(weak.proposal.action).toBe('conflict')
    expect(weak.commit).toBeUndefined()

    const w = memory.why(revised.proposal.knowledge.id)!
    expect(w.history.length).toBe(3)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('review workflow (PRD §10, §23–25)', () => {
  it('propose → automated findings → approve → land, with roles enforced', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'knowledge-review-'))
    process.env.RECALL_CACHE_DIR = dir
    const owner = Repository.init('history.eth', 'owner.eth', { title: 'World History' })
    owner.setPolicy({ reviewers: ['expert.eth'], contributors: 'anyone', approvals: 1 })
    owner.remember({ subject: 'Indian Independence', claim: 'India became independent in 1947', topic: 'independence', sources: [{ type: 'book', title: 'India After Gandhi' }] })
    expect(owner.version()).toBe(1)

    // Historian A proposes a correction from their own branch; they cannot commit to main.
    const store = owner.store
    const historian = new Repository(store)
    store.writeConfig({ ...store.readConfig(), identity: 'historian-a.eth' })
    expect(() => historian.remember({ claim: 'x' })).toThrow(/may not commit/)
    historian.checkout('add-date', { create: true })
    const k = historian.add({ subject: 'Indian Independence', claim: 'India became independent in 1948', topic: 'independence', confidence: 0.6 })
    historian.commit('Correct the year')
    const p = historian.propose({ title: 'Correct independence year' })
    expect(p.status).toBe('under-review')
    expect(p.findings.map((f) => f.kind).sort()).toEqual(['contradiction', 'missing-sources'])
    expect(() => historian.review(p.number, 'approve')).toThrow(/may not review/)
    historian.checkout('main')

    // The reviewer sees the findings and the diff, and approves.
    store.writeConfig({ ...store.readConfig(), identity: 'expert.eth' })
    const reviewer = new Repository(store)
    expect(reviewer.proposalDiff(p.number).added).toBe(1)
    const reviewed = reviewer.review(p.number, 'approve', 'Sources still thin, but the date correction is right.')
    expect(reviewed.status).toBe('approved')

    // Landing stamps the reviewer on the changed object and records the proposal on the commit.
    const landed = reviewer.land(p.number)
    expect(landed.proposal.status).toBe('committed')
    expect(landed.commit?.proposal).toBe(p.id)
    expect(reviewer.version()).toBe(2)
    expect(reviewer.headSnapshot('main')[k.id]?.reviewers).toEqual(['expert.eth'])
    expect(reviewer.resolve('v1').id).toBe(owner.log('main')[1]!.id)

    // A rejected proposal never lands.
    store.writeConfig({ ...store.readConfig(), identity: 'historian-a.eth' })
    const again = new Repository(store)
    again.checkout('remove-it', { create: true })
    again.remove(k.id); again.commit('Remove the claim')
    const p2 = again.propose({ title: 'Remove' })
    expect(p2.findings.map((f) => f.kind)).toEqual(['removal'])
    again.checkout('main')
    store.writeConfig({ ...store.readConfig(), identity: 'expert.eth' })
    const r2 = new Repository(store).review(p2.number, 'reject', 'No.')
    expect(r2.status).toBe('rejected')
    expect(() => new Repository(store).land(p2.number)).toThrow(/rejected/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('a public namespace publishes and pulls in plaintext', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'knowledge-public-'))
    process.env.RECALL_CACHE_DIR = dir
    const storage = new MemoryAdapter()
    let pointer: Hex | null = null
    const fake: Pointer = { read: async () => pointer, write: async (h) => { pointer = h; return 'tx' } }
    const a = Repository.init('science.eth', 'owner.eth')
    a.remember({ claim: 'Water boils at 100 °C at sea level', topic: 'physics', sources: [{ type: 'textbook' }] })
    const res = await new Remote(a, storage, fake).push()
    expect(res.noop).toBe(false)
    // The published bytes are readable without any key.
    const raw = await storage.get(res.refsRef, { plaintext: true })
    expect(JSON.parse(new TextDecoder().decode(raw)).kind).toBe('refs')

    const b = Repository.init('science.eth-reader', 'reader.eth')
    b.store.writeConfig({ ...b.store.readConfig(), namespace: 'science.eth' })
    const pulled = await new Remote(b, storage, fake).pull()
    expect(pulled.fetched.length).toBe(1)
    expect(Object.values(b.headSnapshot('main'))[0]?.claim).toContain('Water boils')
    expect(b.policy.owner).toBe('owner.eth')
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('source connections', () => {
  it('owner connects a source; imports cite it; counts follow the snapshot', () => {
    const dir = mkdtempSync(join(tmpdir(), 'knowledge-sources-'))
    process.env.RECALL_CACHE_DIR = dir
    const r = Repository.init('science.eth', 'owner.eth')
    const c = r.connectSource({ name: 'Wikipedia', kind: 'application', description: 'Encyclopedia' })
    expect(c.id).toBe('wikipedia'); expect(c.contributor).toBe('wikipedia-import')
    r.remember({ claim: 'Water boils at 100 °C at sea level', topic: 'physics', sources: [{ type: 'wikipedia', kind: 'application', name: 'Wikipedia', id: 'https://en.wikipedia.org/wiki/Boiling_point' }] })
    r.remember({ claim: 'Sound travels at about 343 m/s in air', topic: 'physics', sources: [{ type: 'textbook' }] })
    expect(r.sources()[0]?.objects).toBe(1)
    r.store.writeConfig({ ...r.store.readConfig(), identity: 'stranger.eth' })
    expect(() => new Repository(r.store).connectSource({ name: 'X', kind: 'api' })).toThrow(/may not connect/)
    rmSync(dir, { recursive: true, force: true })
  })
})
