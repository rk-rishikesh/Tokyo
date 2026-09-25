import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Hex } from 'viem'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { recoverMessageAddress } from 'viem'
import { MemoryAdapter } from '@knowledge01/storage'
import { Remote, Repository, type Pointer } from '../src/index.js'

const scratch = () => { const d = mkdtempSync(join(tmpdir(), 'knowledge-w-')); process.env.RECALL_CACHE_DIR = d; return d }

describe('W2 — review is a policy', () => {
  it('personal namespaces auto-land, still record findings; public ones gate', () => {
    const d = scratch()
    const me = Repository.init('rishikesh.eth', 'rishikesh.eth', { contentKey: '11'.repeat(32) })
    expect(me.policy.kind).toBe('personal'); expect(me.policy.approvals).toBe(0); expect(me.policy.conflicts).toBe('latest')
    me.remember({ claim: 'Prefers vegetarian food', subject: 'Food', topic: 'food', sources: [{ type: 'observation', kind: 'application', name: 'Swiggy' }] })
    // an agent proposes with no sources → advisory finding only → auto-lands
    me.checkout('agent-1', { create: true })
    me.add({ claim: 'Likes late dinners', subject: 'Meals', topic: 'food', confidence: 0.7 })
    me.commit('observed')
    const p = me.propose({ title: 'Late dinners' })
    expect(p.status).toBe('committed')
    expect(me.version('main')).toBe(2)
    expect(me.findings()).toHaveLength(1)
    expect(me.findings()[0]!.findings.map((f) => f.kind)).toEqual(['missing-sources'])
    me.checkout('main')
    me.resolveFindings(me.findings()[0]!.commit.id)
    expect(me.findings()).toHaveLength(0)

    const pub = Repository.init('worldhistory.eth', 'owner.eth')
    expect(pub.policy.kind).toBe('public'); expect(pub.policy.approvals).toBe(1)
    rmSync(d, { recursive: true, force: true })
  })

  it('a direct ungated commit records its findings in the queue', () => {
    const d = scratch()
    const me = Repository.init('me.eth', 'me.eth', { contentKey: '22'.repeat(32) })
    me.remember({ claim: 'Lives in Bengaluru', subject: 'Home', topic: 'profile' })
    expect(me.findings()).toHaveLength(1) // missing-sources on a direct commit
    rmSync(d, { recursive: true, force: true })
  })
})

describe('W3 — merge and supersession in the repository', () => {
  it('two sources on one claim merge and raise confidence; supersedes retires the old claim', () => {
    const d = scratch()
    const me = Repository.init('food.rishikesh.eth', 'rishikesh.eth', { contentKey: '33'.repeat(32) })
    const a = me.add({ claim: 'Prefers vegetarian food', subject: 'Food', topic: 'preferences', confidence: 0.8, sources: [{ type: 'observation', kind: 'application', name: 'Swiggy', id: 'o1' }] })
    const b = me.add({ claim: 'Prefers vegetarian food', subject: 'Food', topic: 'preferences', confidence: 0.8, contributor: 'zomato-agent', sources: [{ type: 'observation', kind: 'application', name: 'Zomato', id: 'o2' }] })
    expect(b.id).toBe(a.id); expect(b.sources).toHaveLength(2); expect(b.confidence).toBe(0.96); expect(b.contributor).toBe('rishikesh.eth')
    me.commit('two sources')
    const sup = me.add({ claim: 'Eats chicken since March 2026', subject: 'Food', topic: 'preferences', confidence: 0.9, sources: [{ type: 'observation', kind: 'application', name: 'Zomato', id: 'o3' }], supersedes: a.id })
    me.commit('changed')
    expect(me.headSnapshot()[a.id]).toBeUndefined()
    expect(me.headSnapshot()[sup.id]?.supersedes).toBe(a.id)
    expect(me.findings().flatMap((x) => x.findings.map((f) => f.kind))).not.toContain('removal')
    expect(me.why(a.id)).toBeUndefined() // retired
    rmSync(d, { recursive: true, force: true })
  })

  it('observe resolves an unmarked conflict by policy on personal namespaces', () => {
    const d = scratch()
    const me = Repository.init('me2.eth', 'me2.eth', { contentKey: '44'.repeat(32) })
    me.remember({ claim: 'Prefers vegetarian food', subject: 'Food', topic: 'food', confidence: 0.95 })
    const r = me.observe({ claim: 'Ordered chicken biryani twice this week', subject: 'Food', topic: 'food', confidence: 0.8, sources: [{ type: 'observation', name: 'Zomato' }] })
    expect(r.proposal.action).toBe('update'); expect(r.proposal.reason).toContain('policy "latest"')
    expect(Object.values(me.headSnapshot())[0]?.claim).toContain('chicken')
    rmSync(d, { recursive: true, force: true })
  })
})

describe('W4 — publish policy', () => {
  it('reports when a publish is due', () => {
    const d = scratch()
    const me = Repository.init('me3.eth', 'me3.eth', { contentKey: '55'.repeat(32) })
    expect(me.publishDue().due).toBe(false)
    me.setPolicy({ publish: { mode: 'threshold', pendingCommits: 2 } })
    me.remember({ claim: 'a', sources: [{ type: 'x' }] })
    expect(me.publishDue()).toMatchObject({ due: false, pending: 1 })
    me.remember({ claim: 'b', sources: [{ type: 'x' }] })
    expect(me.publishDue()).toMatchObject({ due: true, pending: 2 })
    rmSync(d, { recursive: true, force: true })
  })
})

describe('W5 — signed approvals and fork-and-pull', () => {
  it('a signed approval verifies against the ENS owner; an unsigned one is visibly unverified and blocks when required', async () => {
    const d = scratch()
    const owner = Repository.init('science.eth', 'owner.eth')
    owner.setPolicy({ reviewers: ['expert.eth'], signedApprovals: true })
    owner.remember({ claim: 'Water boils at 100 °C at sea level', topic: 'physics', sources: [{ type: 'textbook' }] })
    owner.checkout('add', { create: true }); owner.add({ claim: 'Sound travels at 343 m/s in air', topic: 'physics', sources: [{ type: 'textbook' }] }); owner.commit('add'); const p = owner.propose({ title: 'Sound' }); owner.checkout('main')

    const expertKey = generatePrivateKey(); const expert = privateKeyToAccount(expertKey)
    const strangerKey = generatePrivateKey(); const stranger = privateKeyToAccount(strangerKey)
    const ownerOf = async (name: string) => (name === 'expert.eth' ? expert.address : null)
    const recover = (message: string, signature: string) => recoverMessageAddress({ message, signature: signature as Hex })

    // stranger signs while claiming to be expert.eth
    const rev = new Repository(owner.store); rev.actingAs = 'expert.eth'
    const at = new Date().toISOString()
    const { message } = rev.reviewText(p.number, 'approve', at)
    const badSig = await stranger.signMessage({ message })
    rev.review(p.number, 'approve', 'looks right', { at, signature: badSig, signer: stranger.address })
    let reviews = await rev.verifyApprovals(p.number, ownerOf, recover)
    expect(reviews[0]?.verified).toBe(false)
    expect(() => rev.land(p.number)).toThrow(/signed approvals/)

    // the real expert signs
    const at2 = new Date().toISOString()
    const { message: m2 } = rev.reviewText(p.number, 'approve', at2)
    const goodSig = await expert.signMessage({ message: m2 })
    rev.review(p.number, 'approve', 'verified', { at: at2, signature: goodSig, signer: expert.address })
    reviews = await rev.verifyApprovals(p.number, ownerOf, recover)
    expect(reviews.find((r) => r.verdict === 'approve')?.verified).toBe(true)
    const landed = rev.land(p.number)
    expect(landed.proposal.status).toBe('committed')
    rmSync(d, { recursive: true, force: true })
  })

  it('a contributor with no access to the owner repository proposes via a bundle; the owner ingests and lands it', async () => {
    const d = scratch()
    const storage = new MemoryAdapter()
    let ptr: Hex | null = null
    const pointer: Pointer = { read: async () => ptr, write: async (h) => { ptr = h; return 'tx' } }
    const owner = Repository.init('science.eth', 'owner.eth')
    owner.remember({ claim: 'Water boils at 100 °C at sea level', topic: 'physics', sources: [{ type: 'textbook' }] })
    await new Remote(owner, storage, pointer).push()

    // contributor: own clone (pulled), own branch, own proposal, exported as a bundle
    const clone = Repository.init('science.eth-clone', 'historian.eth')
    clone.store.writeConfig({ ...clone.store.readConfig(), namespace: 'science.eth' })
    await new Remote(clone, storage, pointer).pull()
    clone.checkout('add-light', { create: true })
    clone.add({ claim: 'Light travels at 299,792 km/s in vacuum', topic: 'physics', sources: [{ type: 'paper', name: 'CODATA' }] })
    clone.commit('Add speed of light')
    const p = clone.propose({ title: 'Add speed of light' })
    const bundle = clone.exportProposal(p.number)
    expect(bundle.commits).toHaveLength(1)
    const { ref } = await new Remote(clone, storage, pointer).publishBundle(bundle)

    // owner: fetch the bundle by CID, import, review, land
    const fetched = await new Remote(owner, storage, pointer).fetchBundle(ref.ref)
    const imported = owner.importProposal(fetched)
    expect(imported.author).toBe('historian.eth'); expect(imported.status).toBe('proposed')
    owner.review(imported.number, 'approve')
    const landed = owner.land(imported.number)
    expect(landed.proposal.status).toBe('committed')
    expect(Object.values(owner.headSnapshot('main')).some((k) => k.claim.includes('Light'))).toBe(true)
    expect(Object.values(owner.headSnapshot('main')).find((k) => k.claim.includes('Light'))?.contributor).toBe('historian.eth')
    rmSync(d, { recursive: true, force: true })
  })
})
