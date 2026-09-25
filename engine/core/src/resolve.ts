/**
 * ENSv2 resolution through the Universal Resolver, done by hand with viem.
 *
 * `@ensdomains/ensjs` targets ENSv1 and is deliberately not a dependency
 * (rule 3). Everything here calls only functions present in the vendored ABIs.
 */
import {
  bytesToHex,
  decodeAbiParameters,
  encodeFunctionData,
  getAddress,
  hexToString,
  keccak256,
  namehash,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem'
import { packetToBytes } from 'viem/ens'
import { abis, UNIVERSAL_RESOLVER } from './contracts.js'

/** DNS-encode a name, the wire format every ENSv2 entrypoint takes. */
export function dnsEncode(name: string): Hex {
  return bytesToHex(packetToBytes(name))
}

export { namehash }

/** Split "collection.publisher.eth" into its label and parent. */
export function splitName(name: string): { label: string; parent: string } {
  const i = name.indexOf('.')
  if (i === -1) return { label: name, parent: '' }
  return { label: name.slice(0, i), parent: name.slice(i + 1) }
}

// ---------------------------------------------------------------------------
// Universal Resolver reads
// ---------------------------------------------------------------------------

/**
 * Resolve an arbitrary resolver call for `name` through the Universal Resolver.
 *
 * Returns the raw ABI-encoded result plus the resolver that answered, so the
 * caller can attribute an answer to a specific resolver contract.
 */
export async function urResolve(
  client: PublicClient,
  name: string,
  callData: Hex,
): Promise<{ result: Hex; resolver: Address }> {
  const [result, resolver] = (await client.readContract({
    address: UNIVERSAL_RESOLVER,
    abi: abis.universalResolver,
    functionName: 'resolve',
    args: [dnsEncode(name), callData],
  })) as [Hex, Address]
  return { result, resolver }
}

/** Read a `text:` record. Returns '' when unset. */
export async function getText(
  client: PublicClient,
  name: string,
  key: string,
): Promise<string> {
  const callData = encodeFunctionData({
    abi: abis.resolver,
    functionName: 'text',
    args: [namehash(name), key],
  })
  const { result } = await urResolve(client, name, callData)
  if (result === '0x') return ''
  const [value] = decodeAbiParameters([{ type: 'string' }], result)
  return value
}

/** Read a `data:` record. Returns '0x' when unset. */
export async function getData(
  client: PublicClient,
  name: string,
  key: string,
): Promise<Hex> {
  const callData = encodeFunctionData({
    abi: abis.resolver,
    functionName: 'data',
    args: [namehash(name), key],
  })
  const { result } = await urResolve(client, name, callData)
  if (result === '0x') return '0x'
  const [value] = decodeAbiParameters([{ type: 'bytes' }], result)
  return value
}

/** Read `contenthash`. Returns '0x' when unset. */
export async function getContenthash(
  client: PublicClient,
  name: string,
): Promise<Hex> {
  const callData = encodeFunctionData({
    abi: abis.resolver,
    functionName: 'contenthash',
    args: [namehash(name)],
  })
  const { result } = await urResolve(client, name, callData)
  if (result === '0x') return '0x'
  const [value] = decodeAbiParameters([{ type: 'bytes' }], result)
  return value
}

/** Read the secp256k1 `pubkey` record as an uncompressed SEC1 point. */
export async function getPubkey(
  client: PublicClient,
  name: string,
): Promise<{ x: Hex; y: Hex } | null> {
  const callData = encodeFunctionData({
    abi: abis.resolver,
    functionName: 'pubkey',
    args: [namehash(name)],
  })
  const { result } = await urResolve(client, name, callData)
  if (result === '0x') return null
  const [x, y] = decodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], result)
  if (BigInt(x) === 0n && BigInt(y) === 0n) return null
  return { x, y }
}

/** Read the `addr` record. */
export async function getAddr(
  client: PublicClient,
  name: string,
): Promise<Address | null> {
  const callData = encodeFunctionData({
    abi: abis.resolver,
    functionName: 'addr',
    args: [namehash(name)],
  })
  const { result } = await urResolve(client, name, callData)
  if (result === '0x') return null
  const [value] = decodeAbiParameters([{ type: 'address' }], result)
  return value === zeroAddress ? null : getAddress(value)
}

// ---------------------------------------------------------------------------
// Registry walk
// ---------------------------------------------------------------------------

/** The resolver responsible for `name`, per the Universal Resolver. */
export async function findResolver(
  client: PublicClient,
  name: string,
): Promise<{ resolver: Address; node: Hex; offset: bigint }> {
  const [resolver, node, offset] = (await client.readContract({
    address: UNIVERSAL_RESOLVER,
    abi: abis.universalResolver,
    functionName: 'findResolver',
    args: [dnsEncode(name)],
  })) as [Address, Hex, bigint]
  return { resolver, node, offset }
}

/**
 * The registry that *canonically* holds `name`.
 *
 * This is the anti-spoofing primitive. Any contract can claim to be a registry
 * and answer `getSubregistry`; only the canonical chain from the root counts.
 * Reads that decide trust must go through here, never through a registry
 * address supplied by a caller.
 */
export async function findCanonicalRegistry(
  client: PublicClient,
  name: string,
): Promise<Address> {
  return (await client.readContract({
    address: UNIVERSAL_RESOLVER,
    abi: abis.universalResolver,
    functionName: 'findCanonicalRegistry',
    args: [dnsEncode(name)],
  })) as Address
}

/** The registry registered at exactly `name`, or the zero address. */
export async function findExactRegistry(
  client: PublicClient,
  name: string,
): Promise<Address> {
  return (await client.readContract({
    address: UNIVERSAL_RESOLVER,
    abi: abis.universalResolver,
    functionName: 'findExactRegistry',
    args: [dnsEncode(name)],
  })) as Address
}

/** The registry holding `name`'s parent — where `name`'s own token lives. */
export async function findParentRegistry(
  client: PublicClient,
  name: string,
): Promise<Address> {
  return (await client.readContract({
    address: UNIVERSAL_RESOLVER,
    abi: abis.universalResolver,
    functionName: 'findParentRegistry',
    args: [dnsEncode(name)],
  })) as Address
}

/** The owner of `name`, per the canonical registry chain. */
export async function findOwner(
  client: PublicClient,
  name: string,
): Promise<Address> {
  return (await client.readContract({
    address: UNIVERSAL_RESOLVER,
    abi: abis.universalResolver,
    functionName: 'findOwner',
    args: [dnsEncode(name)],
  })) as Address
}

/**
 * Confirm that `registry` really is the canonical registry for `name`.
 *
 * Use before trusting anything read out of a registry address that arrived from
 * configuration, a URL, or a user.
 */
export async function assertCanonicalRegistry(
  client: PublicClient,
  name: string,
  registry: Address,
): Promise<void> {
  const canonical = await findCanonicalRegistry(client, name)
  if (getAddress(canonical) !== getAddress(registry)) {
    throw new Error(
      `Registry ${registry} is not canonical for ${name} (canonical: ${canonical})`,
    )
  }
}

// ---------------------------------------------------------------------------
// Registry reads
// ---------------------------------------------------------------------------

/**
 * The current token ID for `label` in `registry`.
 *
 * Never cache this (rule 5). Token IDs in the Permissioned Registry are
 * regenerated when roles change, so a cached id silently starts pointing at
 * nothing. Always resolve immediately before use.
 */
export async function findTokenId(
  client: PublicClient,
  registry: Address,
  label: string,
): Promise<bigint> {
  return (await client.readContract({
    address: registry,
    abi: abis.registry,
    functionName: 'findTokenId',
    args: [label],
  })) as bigint
}

/** Expiry (unix seconds) of `label` in `registry`. 0 means unregistered. */
export async function findExpiry(
  client: PublicClient,
  registry: Address,
  label: string,
): Promise<bigint> {
  return (await client.readContract({
    address: registry,
    abi: abis.registry,
    functionName: 'findExpiry',
    args: [label],
  })) as bigint
}

/** The subregistry a label delegates to, or the zero address. */
export async function getSubregistry(
  client: PublicClient,
  registry: Address,
  label: string,
): Promise<Address> {
  return (await client.readContract({
    address: registry,
    abi: abis.registry,
    functionName: 'getSubregistry',
    args: [label],
  })) as Address
}

/** The resolver a registry assigns to a label. */
export async function getRegistryResolver(
  client: PublicClient,
  registry: Address,
  label: string,
): Promise<Address> {
  return (await client.readContract({
    address: registry,
    abi: abis.registry,
    functionName: 'getResolver',
    args: [label],
  })) as Address
}

export type RegistrationStatus = 'AVAILABLE' | 'RESERVED' | 'REGISTERED'
const STATUS: RegistrationStatus[] = ['AVAILABLE', 'RESERVED', 'REGISTERED']

export type LabelState = {
  status: RegistrationStatus
  expiry: bigint
  latestOwner: Address
  tokenId: bigint
  resource: bigint
}

/**
 * Full registration state for a label.
 *
 * `anyId` in the registry ABI accepts a labelhash, a token ID, or an EAC
 * resource; we pass the labelhash, which is the only one of the three that is
 * stable across role changes.
 */
export async function getState(
  client: PublicClient,
  registry: Address,
  label: string,
): Promise<LabelState> {
  const labelhash = BigInt(keccakLabel(label))
  const s = (await client.readContract({
    address: registry,
    abi: abis.registry,
    functionName: 'getState',
    args: [labelhash],
  })) as {
    status: number
    expiry: bigint
    latestOwner: Address
    tokenId: bigint
    resource: bigint
  }
  return {
    status: STATUS[s.status] ?? 'AVAILABLE',
    expiry: s.expiry,
    latestOwner: s.latestOwner,
    tokenId: s.tokenId,
    resource: s.resource,
  }
}

/** True when `label` is registered in `registry` and not yet expired. */
export async function isLive(
  client: PublicClient,
  registry: Address,
  label: string,
  now: bigint = BigInt(Math.floor(Date.now() / 1000)),
): Promise<boolean> {
  const expiry = await findExpiry(client, registry, label)
  return expiry > now
}

/** labelhash — keccak of the raw label bytes. */
export function keccakLabel(label: string): Hex {
  return keccak256(toHex(label))
}

export { hexToString }

// ---------------------------------------------------------------------------
// Discovered addresses
// ---------------------------------------------------------------------------

/**
 * The root registry, read from the Universal Resolver.
 *
 * Discovered rather than pinned: this address has already changed once on
 * Sepolia. Reading it from the UR means a redeploy of the registries is picked
 * up automatically instead of breaking every read.
 */
export async function getRootRegistry(client: PublicClient): Promise<Address> {
  return (await client.readContract({
    address: UNIVERSAL_RESOLVER,
    abi: abis.universalResolver,
    functionName: 'ROOT_REGISTRY',
  })) as Address
}

/** The `.eth` registry, discovered by walking the root registry. */
export async function getEthRegistry(client: PublicClient): Promise<Address> {
  const root = await getRootRegistry(client)
  return getSubregistry(client, root, 'eth')
}
