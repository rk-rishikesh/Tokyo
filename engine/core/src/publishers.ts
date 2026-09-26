/**
 * A namespace's roles, on chain.
 *
 * A namespace's policy names its owner, reviewers and contributors; this makes
 * the policy true on ENS, on the namespace's own PermissionedResolver.
 *
 *   owner        ROLE_SET_CONTENTHASH and its admin on the root (granted at
 *                `initialize`): publishes, and grants the roles below.
 *   reviewer     ROLE_SET_CONTENTHASH on resource(namehash(name), 0): can
 *                publish what they land, cannot pass the right on.
 *   contributor  ROLE_SET_DATA on the one key `knowledge.proposal.<name>`:
 *                can point the owner at their proposal bundle, and write
 *                nothing else — not the contenthash, not another's key.
 *
 * `setContenthash` checks resource(node, 0); `setData` checks resource(node,
 * partHash(key)), then resource(0, partHash(key)), then resource(node, 0) — so
 * the owner and reviewers could write any key, and a contributor only theirs.
 *
 * Members are ENS names in the policy. The account a name stands for is the
 * one that owns it — the same key that signs approvals — or a raw 0x address.
 */
import { encodeFunctionData, getAddress, hexToString, isAddress, namehash, stringToHex, type Address, type Hex, type PublicClient } from 'viem'
import { abis } from './contracts.js'
import type { Policy } from './knowledge/objects.js'
import { dnsEncode, findOwner, findResolver, getData } from './resolve.js'
import { ResolverRoles, ResolverRolesAdmin, dataKeyResource, nodeResource } from './roles.js'

export const PUBLISH_ROLE = ResolverRoles.SET_CONTENTHASH
export const PROPOSE_ROLE = ResolverRoles.SET_DATA

/** The data key a contributor writes their latest proposal bundle's CID under. */
export const proposalKey = (contributor: string): string => `knowledge.proposal.${contributor.toLowerCase()}`

/** The account an ENS name (or a raw address) stands for, or null if nobody owns it. */
export async function accountOf(client: PublicClient, who: string): Promise<Address | null> {
  if (isAddress(who)) return getAddress(who)
  const owner = await findOwner(client, who).catch(() => null)
  return owner && BigInt(owner) !== 0n ? getAddress(owner) : null
}

/** The namespace's resolver, or null if the name is not registered on chain. */
export async function namespaceResolver(client: PublicClient, namespace: string): Promise<Address | null> {
  const { resolver } = await findResolver(client, namespace).catch(() => ({ resolver: '0x0' as Address }))
  return BigInt(resolver) === 0n ? null : resolver
}

export type Member = { name: string; role: 'owner' | 'reviewer' | 'contributor' }

/** The policy's members, each once, in the strongest role they hold. */
export function policyMembers(policy: Pick<Policy, 'owner' | 'reviewers' | 'contributors'>, extra: { reviewers?: string[]; contributors?: string[] } = {}): Member[] {
  const seen = new Set<string>([policy.owner])
  const out: Member[] = [{ name: policy.owner, role: 'owner' }]
  const add = (names: string[], role: Member['role']) => { for (const name of names) if (!seen.has(name)) { seen.add(name); out.push({ name, role }) } }
  add([...policy.reviewers, ...(extra.reviewers ?? [])], 'reviewer')
  add([...(Array.isArray(policy.contributors) ? policy.contributors : []), ...(extra.contributors ?? [])], 'contributor')
  return out
}

export type OnchainRole = Member & {
  account: Address | null
  /** Holds ROLE_SET_CONTENTHASH on this name (directly or via the root). */
  canPublish: boolean
  /** Can grant publishing to others (holds the admin half). */
  canGrant: boolean
  /** Can write their own proposal key (holding it, or publishing). */
  canPropose: boolean
  /** Holds the proposal key itself (or the root) — what a revocation would remove. */
  holdsKey: boolean
}

/** What ENS says each member may do, read live. */
export async function onchainRoles(client: PublicClient, namespace: string, members: Member[]): Promise<{ resolver: Address | null; roles: OnchainRole[] }> {
  const resolver = await namespaceResolver(client, namespace)
  const node = namehash(namespace)
  const roles = await Promise.all(members.map(async (m): Promise<OnchainRole> => {
    const account = await accountOf(client, m.name)
    if (!resolver || !account) return { ...m, account, canPublish: false, canGrant: false, canPropose: false, holdsKey: false }
    const has = (resource: bigint, bitmap: bigint) => client.readContract({ address: resolver, abi: abis.resolver, functionName: 'hasRoles', args: [resource, bitmap, account] }) as Promise<boolean>
    const [canPublish, canGrant, holdsKey] = await Promise.all([
      has(nodeResource(node), PUBLISH_ROLE),
      has(nodeResource(node), ResolverRolesAdmin.SET_CONTENTHASH),
      has(dataKeyResource(node, proposalKey(m.name)), PROPOSE_ROLE),
    ])
    return { ...m, account, canPublish, canGrant, canPropose: holdsKey || canPublish, holdsKey }
  }))
  return { resolver, roles }
}

/** Calldata granting (or revoking) publishing on `namespace` to `account`. */
export function publisherCall(namespace: string, account: Address, grant: boolean): Hex {
  return encodeFunctionData({ abi: abis.resolver, functionName: 'authorizeNameRoles', args: [dnsEncode(namespace), PUBLISH_ROLE, account, grant] })
}

/** Calldata granting (or revoking) a contributor's own proposal key. */
export function contributorCall(namespace: string, contributor: string, account: Address, grant: boolean): Hex {
  return encodeFunctionData({ abi: abis.resolver, functionName: 'authorizeDataRoles', args: [dnsEncode(namespace), proposalKey(contributor), account, grant] })
}

/** Calldata a contributor sends to point the owner at their proposal bundle. */
export function proposalPointerCall(namespace: string, contributor: string, cid: string): Hex {
  return encodeFunctionData({ abi: abis.resolver, functionName: 'setData', args: [namehash(namespace), proposalKey(contributor), stringToHex(cid)] })
}

/** The CID a contributor has pointed `namespace`'s owner at, if any. */
export async function readProposalPointer(client: PublicClient, namespace: string, contributor: string): Promise<string | null> {
  const v = await getData(client, namespace, proposalKey(contributor)).catch(() => '0x' as Hex)
  return v === '0x' ? null : hexToString(v)
}

export type RoleChange = { name: string; account: Address; kind: 'publish' | 'propose'; grant: boolean }

/**
 * The grants and revocations that make ENS match the policy. Accounts that
 * already hold the root roles (the owner, or an admin) are left alone; a name
 * nobody owns cannot be granted and is reported instead.
 */
export function planRoles(current: OnchainRole[], want: { reviewers: string[]; contributors: string[] }): { changes: RoleChange[]; unresolved: string[] } {
  const reviewers = new Set(want.reviewers)
  const contributors = new Set(want.contributors)
  const changes: RoleChange[] = []
  const unresolved: string[] = []
  for (const r of current) {
    if (r.role === 'owner') continue
    const wanted = reviewers.has(r.name) || contributors.has(r.name)
    if (!r.account) { if (wanted) unresolved.push(r.name); continue }
    if (r.canGrant) continue // publishes through the root
    const review = reviewers.has(r.name)
    if (review && !r.canPublish) changes.push({ name: r.name, account: r.account, kind: 'publish', grant: true })
    if (!review && r.canPublish) changes.push({ name: r.name, account: r.account, kind: 'publish', grant: false })
    // A reviewer can write any key already; the proposal key is for contributors who are not.
    const propose = contributors.has(r.name) && !review
    if (propose && !r.holdsKey) changes.push({ name: r.name, account: r.account, kind: 'propose', grant: true })
    if (!propose && r.holdsKey) changes.push({ name: r.name, account: r.account, kind: 'propose', grant: false })
  }
  return { changes, unresolved }
}

/** The calldata for one planned change. */
export const roleChangeCall = (namespace: string, c: RoleChange): Hex =>
  c.kind === 'publish' ? publisherCall(namespace, c.account, c.grant) : contributorCall(namespace, c.name, c.account, c.grant)
