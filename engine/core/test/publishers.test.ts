import { describe, expect, it } from 'vitest'
import { decodeFunctionData, getAddress, hexToString } from 'viem'
import { abis, contributorCall, dnsEncode, planRoles, policyMembers, proposalKey, proposalPointerCall, publisherCall, ResolverRoles, type OnchainRole } from '../src/index.js'

const A = getAddress('0x00000000000000000000000000000000000000a1')
const B = getAddress('0x00000000000000000000000000000000000000b2')
const O = getAddress('0x00000000000000000000000000000000000000c3')
type Flags = Partial<Pick<OnchainRole, 'canPublish' | 'canGrant' | 'canPropose' | 'holdsKey'>>
const r = (name: string, role: OnchainRole['role'], account: string | null, f: Flags = {}): OnchainRole =>
  ({ name, role, account: account as OnchainRole['account'], canPublish: false, canGrant: false, canPropose: false, holdsKey: false, ...f })
const none = { reviewers: [] as string[], contributors: [] as string[] }

describe('planRoles', () => {
  it('grants publishing to new reviewers and revokes it from dropped ones', () => {
    const { changes } = planRoles([r('o.eth', 'owner', O, { canPublish: true, canGrant: true }), r('new.eth', 'reviewer', A), r('gone.eth', 'reviewer', B, { canPublish: true })], { ...none, reviewers: ['new.eth'] })
    expect(changes).toEqual([{ name: 'new.eth', account: A, kind: 'publish', grant: true }, { name: 'gone.eth', account: B, kind: 'publish', grant: false }])
  })
  it('grants a named contributor their proposal key, and revokes it when dropped', () => {
    expect(planRoles([r('c.eth', 'contributor', A)], { ...none, contributors: ['c.eth'] }).changes).toEqual([{ name: 'c.eth', account: A, kind: 'propose', grant: true }])
    expect(planRoles([r('c.eth', 'contributor', A, { canPropose: true, holdsKey: true })], none).changes).toEqual([{ name: 'c.eth', account: A, kind: 'propose', grant: false }])
  })
  it('gives a reviewer who is also a contributor publishing only', () => {
    expect(planRoles([r('both.eth', 'reviewer', A)], { reviewers: ['both.eth'], contributors: ['both.eth'] }).changes).toEqual([{ name: 'both.eth', account: A, kind: 'publish', grant: true }])
  })
  it('revokes a stale proposal key from someone promoted to reviewer', () => {
    expect(planRoles([r('p.eth', 'reviewer', A, { canPublish: true, canPropose: true, holdsKey: true })], { reviewers: ['p.eth'], contributors: [] }).changes).toEqual([{ name: 'p.eth', account: A, kind: 'propose', grant: false }])
  })
  it('does nothing when ENS already matches', () => {
    expect(planRoles([r('a.eth', 'reviewer', A, { canPublish: true, canPropose: true })], { ...none, reviewers: ['a.eth'] }).changes).toEqual([])
  })
  it('leaves accounts that hold the root roles alone', () => {
    expect(planRoles([r('self.eth', 'reviewer', O, { canPublish: true, canGrant: true, canPropose: true, holdsKey: true })], none).changes).toEqual([])
  })
  it('reports members with no owner on ENS', () => {
    expect(planRoles([r('nobody.eth', 'reviewer', null)], { ...none, reviewers: ['nobody.eth'] })).toEqual({ changes: [], unresolved: ['nobody.eth'] })
  })
})

describe('policyMembers', () => {
  it('lists each name once, in its strongest role, and ignores contributors: anyone', () => {
    expect(policyMembers({ owner: 'o.eth', reviewers: ['r.eth', 'o.eth'], contributors: ['c.eth', 'r.eth'] })).toEqual([{ name: 'o.eth', role: 'owner' }, { name: 'r.eth', role: 'reviewer' }, { name: 'c.eth', role: 'contributor' }])
    expect(policyMembers({ owner: 'o.eth', reviewers: [], contributors: 'anyone' })).toEqual([{ name: 'o.eth', role: 'owner' }])
  })
})

describe('calldata', () => {
  it('grants reviewers ROLE_SET_CONTENTHASH on the name, never its admin', () => {
    const { functionName, args } = decodeFunctionData({ abi: abis.resolver, data: publisherCall('research.eth', A, true) })
    expect(functionName).toBe('authorizeNameRoles')
    expect(args).toEqual([dnsEncode('research.eth'), ResolverRoles.SET_CONTENTHASH, A, true])
  })
  it('grants contributors ROLE_SET_DATA on their own key only', () => {
    const { functionName, args } = decodeFunctionData({ abi: abis.resolver, data: contributorCall('research.eth', 'Lab.eth', A, true) })
    expect(functionName).toBe('authorizeDataRoles')
    expect(args).toEqual([dnsEncode('research.eth'), 'knowledge.proposal.lab.eth', A, true])
  })
  it('points the owner at a bundle CID under the contributor key', () => {
    const { functionName, args } = decodeFunctionData({ abi: abis.resolver, data: proposalPointerCall('research.eth', 'lab.eth', 'bafy123') })
    expect(functionName).toBe('setData')
    expect(args[1]).toBe(proposalKey('lab.eth'))
    expect(hexToString(args[2] as `0x${string}`)).toBe('bafy123')
  })
})
