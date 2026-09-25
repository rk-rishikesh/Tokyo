import { describe, expect, it } from 'vitest'
import { decodeFunctionData, namehash, stringToHex, zeroAddress } from 'viem'
import {
  acceptProposalCalls,
  authorizeProposalKeys,
  openProposalCalls,
  parseStatus,
  PROPOSAL_KEYS,
  PROPOSAL_TERM_SECONDS,
  proposalName,
  rejectProposalCalls,
  submitProposalCalls,
} from '../src/proposal.js'
import { abis } from '../src/contracts.js'
import { dataKeyResource, nodeResource, ResolverRoles } from '../src/roles.js'

const COLLECTION = 'exploits.auditor.eth'
const REGISTRY = '0x1111111111111111111111111111111111111111' as const
const RESOLVER = '0x2222222222222222222222222222222222222222' as const
const ALICE = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa' as const
const BOB = '0xbBbBBBBbbBBBbbbBbbBbbbbbBBbBbbbbBbBbbBBbB' as const

describe('opening a proposal', () => {
  const calls = openProposalCalls({
    collection: COLLECTION,
    n: 4,
    contributor: ALICE,
    collectionRegistry: REGISTRY,
    collectionResolver: RESOLVER,
    now: 1_757_745_600,
  })

  it('registers the name and grants exactly two keys — three calls, no more', () => {
    expect(calls).toHaveLength(3)
    expect(calls[0]!.functionName).toBe('register')
    expect(calls[1]!.functionName).toBe('authorizeDataRoles')
    expect(calls[2]!.functionName).toBe('authorizeDataRoles')
  })

  it('registers to the contributor with no registry roles', () => {
    const [label, owner, subregistry, resolver, roleBitmap, expiry] = calls[0]!.args as [
      string,
      string,
      string,
      string,
      bigint,
      bigint,
    ]
    expect(label).toBe('pr-4')
    expect(owner).toBe(ALICE)
    expect(subregistry).toBe(zeroAddress)
    expect(resolver).toBe(RESOLVER)
    // Owning the token must not be authority over the name.
    expect(roleBitmap).toBe(0n)
    expect(expiry).toBe(BigInt(1_757_745_600 + PROPOSAL_TERM_SECONDS))
  })

  it('expires in seven days', () => {
    expect(PROPOSAL_TERM_SECONDS).toBe(7 * 24 * 60 * 60)
  })

  it('grants only candidateRef and parentRef', () => {
    const keys = calls.slice(1).map((c) => (c.args as unknown[])[1])
    expect(keys.sort()).toEqual(['candidateRef', 'parentRef'])
  })

  it('passes a DNS-encoded name, not a string or a namehash', () => {
    const toName = (calls[1]!.args as unknown[])[0] as string
    // DNS wire format: length-prefixed labels. "pr-4" is 4 bytes, so 0x04...
    expect(toName.startsWith('0x04')).toBe(true)
    expect(toName).not.toBe(namehash(proposalName(COLLECTION, 4)))
  })

  it('targets the resolver for grants and the registry for registration', () => {
    expect(calls[0]!.address).toBe(REGISTRY)
    expect(calls[1]!.address).toBe(RESOLVER)
    expect(calls[2]!.address).toBe(RESOLVER)
  })
})

describe('the scope of what a contributor gets', () => {
  it('is one resource per key, distinct from the name-wide resource', () => {
    const node = namehash(proposalName(COLLECTION, 4))
    const candidate = dataKeyResource(node, PROPOSAL_KEYS.candidateRef)
    const parent = dataKeyResource(node, PROPOSAL_KEYS.parentRef)

    expect(candidate).not.toBe(parent)
    // Neither is the name-wide resource, so neither implies broader rights.
    expect(candidate).not.toBe(nodeResource(node))
    expect(parent).not.toBe(nodeResource(node))
  })

  it('does not reach another contributor’s proposal', () => {
    const mine = dataKeyResource(namehash(proposalName(COLLECTION, 4)), PROPOSAL_KEYS.candidateRef)
    const theirs = dataKeyResource(namehash(proposalName(COLLECTION, 5)), PROPOSAL_KEYS.candidateRef)
    expect(mine).not.toBe(theirs)
  })

  it('does not reach the collection’s own contenthash', () => {
    // The merge is gated on ROLE_SET_CONTENTHASH at the collection node. A proposal
    // grant is ROLE_SET_DATA at a proposal key — different role, different
    // resource, different name.
    const proposalResource = dataKeyResource(
      namehash(proposalName(COLLECTION, 4)),
      PROPOSAL_KEYS.candidateRef,
    )
    expect(proposalResource).not.toBe(nodeResource(namehash(COLLECTION)))
    expect(ResolverRoles.SET_DATA).not.toBe(ResolverRoles.SET_CONTENTHASH)
  })

  it('can be revoked with the same call shape', () => {
    const revoke = authorizeProposalKeys({
      collection: COLLECTION,
      n: 4,
      contributor: ALICE,
      collectionResolver: RESOLVER,
      grant: false,
    })
    expect(revoke).toHaveLength(2)
    expect((revoke[0]!.args as unknown[])[3]).toBe(false)
  })
})

describe('submitting a proposal', () => {
  const calls = submitProposalCalls({
    collection: COLLECTION,
    n: 4,
    candidateRef: 'bafyCandidate',
    parentRef: 'bafyParent',
    collectionResolver: RESOLVER,
  })

  it('writes both records in a single multicall', () => {
    expect(calls).toHaveLength(1)
    expect(calls[0]!.functionName).toBe('multicall')
    expect((calls[0]!.args as unknown[][])[0]).toHaveLength(2)
  })

  it('encodes setData calls the resolver will accept', () => {
    const inner = (calls[0]!.args as `0x${string}`[][])[0]!
    const decoded = inner.map((data) =>
      decodeFunctionData({ abi: abis.resolver, data }),
    )
    expect(decoded.map((d) => d.functionName)).toEqual(['setData', 'setData'])
    expect(decoded[0]!.args![1]).toBe('candidateRef')
    expect(decoded[1]!.args![1]).toBe('parentRef')
  })

  it('records the parent ref, which is what makes staleness detectable', () => {
    const inner = (calls[0]!.args as `0x${string}`[][])[0]!
    const parent = decodeFunctionData({ abi: abis.resolver, data: inner[1]! })
    expect(parent.args![2]).toBe(stringToHex('bafyParent'))
  })

  it('treats a proposal against an empty collection as an empty parent, not a failure', () => {
    const first = submitProposalCalls({
      collection: COLLECTION,
      n: 1,
      candidateRef: 'bafyFirst',
      parentRef: null,
      collectionResolver: RESOLVER,
    })
    const inner = (first[0]!.args as `0x${string}`[][])[0]!
    const parent = decodeFunctionData({ abi: abis.resolver, data: inner[1]! })
    expect(parent.args![2]).toBe('0x')
  })
})

describe('deciding', () => {
  it('accepting is a single contenthash move on the collection itself', () => {
    const calls = acceptProposalCalls({
      collection: COLLECTION,
      contenthash: '0xe30101701220aa',
      collectionResolver: RESOLVER,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.functionName).toBe('setContenthash')
    expect((calls[0]!.args as unknown[])[0]).toBe(namehash(COLLECTION))
  })

  it('rejecting writes a status the contributor can read', () => {
    const calls = rejectProposalCalls({
      collection: COLLECTION,
      n: 4,
      reason: 'duplicate of reentrancy-in-vault',
      collectionResolver: RESOLVER,
    })
    expect(calls[0]!.functionName).toBe('setData')
    expect((calls[0]!.args as unknown[])[1]).toBe('status')
  })

  it('round-trips a rejection through the status record', () => {
    const calls = rejectProposalCalls({
      collection: COLLECTION,
      n: 4,
      reason: 'out of scope',
      collectionResolver: RESOLVER,
    })
    const encoded = (calls[0]!.args as unknown[])[2] as `0x${string}`
    expect(parseStatus(encoded)).toEqual({ status: 'rejected', reason: 'out of scope' })
  })

  it('treats an unset status as open', () => {
    expect(parseStatus('0x')).toEqual({ status: 'open' })
  })

  it('rejects on behalf of the owner only — the call targets the collection resolver', () => {
    // The contributor holds SET_DATA on candidateRef/parentRef only, so this
    // write is not one they can make.
    const calls = rejectProposalCalls({ collection: COLLECTION, n: 4, reason: 'no', collectionResolver: RESOLVER })
    expect(calls[0]!.address).toBe(RESOLVER)
    expect((calls[0]!.args as unknown[])[1]).not.toBe(PROPOSAL_KEYS.candidateRef)
  })
})

describe('two contributors', () => {
  it('get disjoint grants', () => {
    const a = openProposalCalls({
      collection: COLLECTION, n: 4, contributor: ALICE, collectionRegistry: REGISTRY, collectionResolver: RESOLVER,
    })
    const b = openProposalCalls({
      collection: COLLECTION, n: 5, contributor: BOB, collectionRegistry: REGISTRY, collectionResolver: RESOLVER,
    })
    const aNames = a.slice(1).map((c) => (c.args as unknown[])[0])
    const bNames = b.slice(1).map((c) => (c.args as unknown[])[0])
    expect(aNames[0]).not.toBe(bNames[0])
    expect((a[1]!.args as unknown[])[2]).toBe(ALICE)
    expect((b[1]!.args as unknown[])[2]).toBe(BOB)
  })
})
