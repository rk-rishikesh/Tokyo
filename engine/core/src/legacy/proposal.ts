/**
 * The contribution loop.
 *
 * A proposal is a short-lived subname carrying two data records, written by
 * exactly one contributor:
 *
 *   data: candidateRef  — the version they propose
 *   data: parentRef     — the version they wrote it against
 *
 * The second is what makes the fast-forward check meaningful, and it is why a
 * proposal is two records rather than one.
 *
 * Three parties, three distinct sets of rights, none of them overlapping:
 *
 *   - the **owner** registers the proposal name (they hold ROLE_REGISTRAR on
 *     the collection subregistry) and grants the contributor write access to those
 *     two keys and nothing else;
 *   - the **contributor** writes those two records, and can touch nothing else
 *     anywhere — not the collection, not another contributor's proposal;
 *   - the **owner** accepts by moving the collection's contenthash, or declines by
 *     writing a status record.
 *
 * Everything here returns *call descriptors* rather than sending anything. The
 * MCP server must not sign (rule 6), and the console signs with the user's own
 * wallet, so both consume the same descriptions of what to call.
 */
import { encodeFunctionData, namehash, stringToHex, type Abi, type Address, type Hex } from 'viem'
import { abis } from './contracts.js'
import { dnsEncode, keccakLabel } from './resolve.js'

/** Data keys on a proposal name. */
export const PROPOSAL_KEYS = {
  candidateRef: 'candidateRef',
  parentRef: 'parentRef',
  /** Written by the owner when a proposal is declined. */
  status: 'status',
} as const

/** Proposal names expire quickly — an unreviewed proposal should not linger. */
export const PROPOSAL_TERM_SECONDS = 7 * 24 * 60 * 60

export type ProposalStatus = 'open' | 'rejected'

/** `pr-<n>.<collection>` */
export const proposalName = (collection: string, n: number): string => `pr-${n}.${collection}`
export const proposalLabel = (n: number): string => `pr-${n}`

/**
 * A contract call, described but not sent.
 *
 * Shaped to drop straight into viem's `writeContract` or wagmi's
 * `writeContractAsync` without either side rebuilding it.
 */
export type CallDescriptor = {
  address: Address
  abi: Abi
  functionName: string
  args: readonly unknown[]
  /** Human-readable, for confirmation prompts and dry runs. */
  describe: string
}

/**
 * Owner: register the proposal name and scope write access to one contributor.
 *
 * The registration grants the contributor **no registry roles** — they hold the
 * token but cannot repoint its resolver or subregistry. Their entire power is
 * the two data-key grants that follow.
 */
export function openProposalCalls(params: {
  collection: string
  n: number
  contributor: Address
  collectionRegistry: Address
  collectionResolver: Address
  now?: number
}): CallDescriptor[] {
  const { collection, n, contributor, collectionRegistry, collectionResolver } = params
  const now = params.now ?? Math.floor(Date.now() / 1000)
  const name = proposalName(collection, n)
  const expiry = BigInt(now + PROPOSAL_TERM_SECONDS)

  return [
    {
      address: collectionRegistry,
      abi: abis.registry,
      functionName: 'register',
      args: [
        proposalLabel(n),
        contributor,
        // No subregistry: a proposal has no children.
        '0x0000000000000000000000000000000000000000',
        collectionResolver,
        // No registry roles. Owning the token is not authority over the name.
        0n,
        expiry,
      ],
      describe: `register ${name} to ${contributor}, expiring in 7 days`,
    },
    ...authorizeProposalKeys({ collection, n, contributor, collectionResolver, grant: true }),
  ]
}

/**
 * Grant (or revoke) the contributor's write access to exactly the two proposal
 * keys.
 *
 * `authorizeDataRoles` takes a **DNS-encoded** name, not a string and not a
 * namehash. It grants `ROLE_SET_DATA` on `resource(node, partHash(key))`, which
 * is the resource `setData` checks for that one key — so this is write access to
 * one record on one name, and nothing wider.
 */
export function authorizeProposalKeys(params: {
  collection: string
  n: number
  contributor: Address
  collectionResolver: Address
  grant: boolean
}): CallDescriptor[] {
  const { collection, n, contributor, collectionResolver, grant } = params
  const name = proposalName(collection, n)
  const encoded = dnsEncode(name)

  return ([PROPOSAL_KEYS.candidateRef, PROPOSAL_KEYS.parentRef] as const).map((key) => ({
    address: collectionResolver,
    abi: abis.resolver,
    functionName: 'authorizeDataRoles',
    args: [encoded, key, contributor, grant],
    describe: `${grant ? 'grant' : 'revoke'} ${contributor} write access to data:${key} on ${name}`,
  }))
}

/**
 * Contributor: write the two records.
 *
 * Refs are stored as UTF-8 bytes so they are readable in an explorer and
 * decode without a codec. Both writes go in one `multicall` — they describe a
 * single proposal and a half-written one is meaningless.
 */
export function submitProposalCalls(params: {
  collection: string
  n: number
  candidateRef: string
  parentRef: string | null
  collectionResolver: Address
}): CallDescriptor[] {
  const { collection, n, candidateRef, parentRef, collectionResolver } = params
  const node = namehash(proposalName(collection, n))

  const inner = [
    encodeSetData(node, PROPOSAL_KEYS.candidateRef, candidateRef),
    // An empty parent is a proposal against an empty collection, which is legitimate.
    encodeSetData(node, PROPOSAL_KEYS.parentRef, parentRef ?? ''),
  ]

  return [
    {
      address: collectionResolver,
      abi: abis.resolver,
      functionName: 'multicall',
      args: [inner],
      describe: `write candidateRef=${candidateRef} and parentRef=${parentRef ?? '(empty)'} on ${proposalName(collection, n)}`,
    },
  ]
}

/**
 * Owner: decline a proposal, on the record.
 *
 * Ignoring a proposal until it expires is also a rejection, but it is a silent
 * one — the contributor learns nothing and the audit log cannot distinguish
 * "considered and declined" from "never looked". This makes the decision a fact.
 */
export function rejectProposalCalls(params: {
  collection: string
  n: number
  reason: string
  collectionResolver: Address
}): CallDescriptor[] {
  const { collection, n, reason, collectionResolver } = params
  const node = namehash(proposalName(collection, n))
  return [
    {
      address: collectionResolver,
      abi: abis.resolver,
      functionName: 'setData',
      args: [node, PROPOSAL_KEYS.status, stringToHex(`rejected:${reason}`)],
      describe: `mark ${proposalName(collection, n)} rejected — ${reason}`,
    },
  ]
}

/**
 * Owner: accept, by moving the collection's pointer.
 *
 * This is the whole merge. There is no separate merge transaction because there
 * is nothing else to change — the proposal was never part of the collection.
 */
export function acceptProposalCalls(params: {
  collection: string
  contenthash: Hex
  collectionResolver: Address
}): CallDescriptor[] {
  return [
    {
      address: params.collectionResolver,
      abi: abis.resolver,
      functionName: 'setContenthash',
      args: [namehash(params.collection), params.contenthash],
      describe: `point ${params.collection} at the proposed version`,
    },
  ]
}

// ---------------------------------------------------------------------------

function encodeSetData(node: Hex, key: string, value: string): Hex {
  return encodeFunctionData({
    abi: abis.resolver,
    functionName: 'setData',
    args: [node, key, value === '' ? '0x' : stringToHex(value)],
  })
}

/** Decode a `data:` record that holds a UTF-8 ref or status string. */
export function decodeDataString(value: Hex): string | null {
  if (!value || value === '0x') return null
  try {
    const bytes = Buffer.from(value.slice(2), 'hex')
    const s = new TextDecoder().decode(bytes).replace(/\0+$/, '')
    return s.length > 0 ? s : null
  } catch {
    return null
  }
}

/** Parse a status record written by `rejectProposalCalls`. */
export function parseStatus(value: Hex): { status: ProposalStatus; reason?: string } {
  const raw = decodeDataString(value)
  if (!raw) return { status: 'open' }
  if (raw.startsWith('rejected:')) {
    return { status: 'rejected', reason: raw.slice('rejected:'.length) || undefined }
  }
  return { status: 'open' }
}

export { keccakLabel }
