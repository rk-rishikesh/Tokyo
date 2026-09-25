import { keccak256, encodeAbiParameters, toHex, type Hex } from 'viem'

/**
 * ENSv2 EnhancedAccessControl (EAC) role bitmaps.
 *
 * EAC packs 64 role slots into a uint256 as nybbles (4 bits each):
 *   - slots 0..31  (bits 0..127)   regular roles
 *   - slots 32..63 (bits 128..255) admin roles, each exactly `regular << 128`
 *
 * A nybble holds an *assignee count* (0-15), not a boolean. Granting a role to a
 * second account increments the nybble; revoking decrements it. `ALL_ROLES` has
 * bit 0 of every nybble set, which is what "one unit in each slot" means.
 *
 * Values transcribed from the vendored libraries at the pinned commit in CONTRACTS.md:
 *   RegistryRolesLib.sol, EACBaseRolesLib.sol, PermissionedResolverLib.sol
 */

/** Mask with bit 0 set in every nybble — one unit per role slot across all 64 slots. */
export const ALL_ROLES =
  0x1111111111111111111111111111111111111111111111111111111111111111n

/** Mask selecting only the 32 admin nybbles (upper 128 bits). */
export const ADMIN_ROLES =
  0x1111111111111111111111111111111100000000000000000000000000000000n

/** The EAC root resource. Roles held here apply to every resource on the contract. */
export const ROOT_RESOURCE = 0n

const admin = (role: bigint) => role << 128n

/** Roles defined by `PermissionedRegistry` (RegistryRolesLib.sol). */
export const RegistryRoles = {
  /** Nybble 0: register and reserve new names. */
  REGISTRAR: 1n << 0n,
  /** Nybble 1: register a name that is currently RESERVED. */
  REGISTER_RESERVED: 1n << 4n,
  /** Nybble 2: set the parent registry. */
  SET_PARENT: 1n << 8n,
  /** Nybble 3: unregister names. */
  UNREGISTER: 1n << 12n,
  /** Nybble 4: extend name expiry. */
  RENEW: 1n << 16n,
  /** Nybble 5: change a name's child registry. */
  SET_SUBREGISTRY: 1n << 20n,
  /** Nybble 6: change a name's resolver. */
  SET_RESOLVER: 1n << 24n,
  /** Nybble 8: tags a name registered via REGISTER_RESERVED. Not revokable. */
  WAS_RESERVED: 1n << 32n,
  /** Nybble 9: set the token URI. */
  SET_URI: 1n << 36n,
  /** Nybble 30: contract naming. */
  CAN_NAME: 1n << 120n,
  /** Nybble 31: UUPS proxy upgrades. */
  UPGRADE: 1n << 124n,
} as const

export const RegistryRolesAdmin = {
  REGISTRAR: admin(RegistryRoles.REGISTRAR),
  REGISTER_RESERVED: admin(RegistryRoles.REGISTER_RESERVED),
  SET_PARENT: admin(RegistryRoles.SET_PARENT),
  UNREGISTER: admin(RegistryRoles.UNREGISTER),
  RENEW: admin(RegistryRoles.RENEW),
  SET_SUBREGISTRY: admin(RegistryRoles.SET_SUBREGISTRY),
  SET_RESOLVER: admin(RegistryRoles.SET_RESOLVER),
  SET_URI: admin(RegistryRoles.SET_URI),
  CAN_NAME: admin(RegistryRoles.CAN_NAME),
  UPGRADE: admin(RegistryRoles.UPGRADE),
  /**
   * Nybble 39, admin-only: authorizes ERC1155 transfers. There is no regular
   * counterpart — the role exists only in the admin half.
   */
  CAN_TRANSFER: (1n << 28n) << 128n,
} as const

/** Roles defined by `PermissionedResolver` (PermissionedResolverLib.sol). */
export const ResolverRoles = {
  /** Nybble 0: setAddr */
  SET_ADDR: 1n << 0n,
  /** Nybble 1: setText */
  SET_TEXT: 1n << 4n,
  /** Nybble 2: setContenthash */
  SET_CONTENTHASH: 1n << 8n,
  /** Nybble 3: setPubkey */
  SET_PUBKEY: 1n << 12n,
  /** Nybble 4: setABI */
  SET_ABI: 1n << 16n,
  /** Nybble 5: setInterface */
  SET_INTERFACE: 1n << 20n,
  /** Nybble 6: setName */
  SET_NAME: 1n << 24n,
  /** Nybble 7: setAlias */
  SET_ALIAS: 1n << 28n,
  /** Nybble 8: clear records */
  CLEAR: 1n << 32n,
  /** Nybble 9: setData */
  SET_DATA: 1n << 36n,
  /** Nybble 30: contract naming */
  CAN_NAME: 1n << 120n,
  /** Nybble 31: UUPS proxy upgrades */
  UPGRADE: 1n << 124n,
} as const

export const ResolverRolesAdmin = {
  SET_ADDR: admin(ResolverRoles.SET_ADDR),
  SET_TEXT: admin(ResolverRoles.SET_TEXT),
  SET_CONTENTHASH: admin(ResolverRoles.SET_CONTENTHASH),
  SET_PUBKEY: admin(ResolverRoles.SET_PUBKEY),
  SET_ABI: admin(ResolverRoles.SET_ABI),
  SET_INTERFACE: admin(ResolverRoles.SET_INTERFACE),
  SET_NAME: admin(ResolverRoles.SET_NAME),
  SET_ALIAS: admin(ResolverRoles.SET_ALIAS),
  CLEAR: admin(ResolverRoles.CLEAR),
  SET_DATA: admin(ResolverRoles.SET_DATA),
  CAN_NAME: admin(ResolverRoles.CAN_NAME),
  UPGRADE: admin(ResolverRoles.UPGRADE),
} as const

/** Combine role constants into a single bitmap. */
export const combineRoles = (...roles: bigint[]): bigint =>
  roles.reduce((acc, r) => acc | r, 0n)

/**
 * Mirror of `EACBaseRolesLib.withAdminRolesApplied` — holding an admin role
 * implies holding its regular counterpart.
 */
export function withAdminRolesApplied(roleBitmap: bigint): bigint {
  const upper = roleBitmap >> 128n
  return (upper << 128n) | upper
}

/**
 * Mirror of `EACBaseRolesLib.fromCounts` — collapse an assignee-count bitmap
 * into a role bitmap.
 *
 * `roleCount(resource)` returns a *count* per nybble (0-15), not a flag. So a
 * role held by two accounts is `2 << (4*slot)`, and testing it with
 * `counts & (1 << (4*slot))` returns zero — the role looks unheld precisely
 * when it is held twice. This normalises any non-zero nybble down to bit 0,
 * which is what makes a plain mask safe afterwards.
 */
export function rolesFromCounts(counts: bigint): bigint {
  return (counts | (counts >> 1n) | (counts >> 2n) | (counts >> 3n)) & ALL_ROLES
}

/** True if `bitmap` sets bits outside the legal nybble positions. */
export function isValidRoleBitmap(bitmap: bigint): boolean {
  if (bitmap < 0n || bitmap > (1n << 256n) - 1n) return false
  // Every nybble must be a count 0..15, which any nybble already is; the real
  // constraint EAC enforces is that granting uses only bit 0 of each nybble.
  return (bitmap & ~ALL_ROLES) === 0n
}

/** Decode a bitmap into the indices of the nybbles that are non-zero. */
export function decodeRoleSlots(bitmap: bigint): number[] {
  const slots: number[] = []
  for (let i = 0; i < 64; i++) {
    const nybble = (bitmap >> BigInt(i * 4)) & 0xfn
    if (nybble !== 0n) slots.push(i)
  }
  return slots
}

/** Encode a list of nybble indices back into a bitmap with one unit each. */
export function encodeRoleSlots(slots: number[]): bigint {
  return slots.reduce((acc, i) => acc | (1n << BigInt(i * 4)), 0n)
}

/** Read the assignee count (0-15) held in a nybble. */
export function roleCount(bitmap: bigint, slot: number): number {
  return Number((bitmap >> BigInt(slot * 4)) & 0xfn)
}

/** Name every known role present in a bitmap, for audit/debug output. */
export function describeRoles(
  bitmap: bigint,
  table: Record<string, bigint>,
): string[] {
  return Object.entries(table)
    .filter(([, v]) => (bitmap & v) === v && v !== 0n)
    .map(([k]) => k)
}

// ---------------------------------------------------------------------------
// EAC resources on PermissionedResolver
// ---------------------------------------------------------------------------

/** The all-zero `part`, selecting the name-wide resource. */
export const ZERO_PART: Hex =
  '0x0000000000000000000000000000000000000000000000000000000000000000'

/**
 * Mirror of `PermissionedResolverLib.resource(node, part)`.
 *
 * The resolver scopes permissions to a *(name, record-key)* pair rather than to
 * the name alone. That is what lets a collection maintainer grant one contributor
 * write access to exactly one proposal key and nothing else.
 *
 * Note the zero case: `resource(0, 0)` is the root resource, so the contract
 * short-circuits rather than hashing.
 */
export function resolverResource(node: Hex, part: Hex): bigint {
  if (
    BigInt(node) === 0n &&
    BigInt(part) === 0n
  ) {
    return 0n
  }
  return BigInt(
    keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [node, part])),
  )
}

/** Mirror of `PermissionedResolverLib.partHash(string)` — for text and data keys. */
export function partHashString(key: string): Hex {
  return keccak256(toHex(key))
}

/** Mirror of `PermissionedResolverLib.partHash(uint256)` — for coin types and content types. */
export function partHashUint(value: bigint): Hex {
  return keccak256(encodeAbiParameters([{ type: 'uint256' }], [value]))
}

/**
 * The resource guarding a single `data:` key on a name. Granting
 * `ResolverRoles.SET_DATA` here lets an account call
 * `setData(node, key, ...)` for this key only.
 */
export const dataKeyResource = (node: Hex, key: string): bigint =>
  resolverResource(node, partHashString(key))

/** The resource guarding a single `text:` key on a name. */
export const textKeyResource = (node: Hex, key: string): bigint =>
  resolverResource(node, partHashString(key))

/**
 * The "widest" resource for a name: `resource(node, 0)`. Admin roles are checked
 * here, and it is the resource the resolver reverts against.
 */
export const nodeResource = (node: Hex): bigint => resolverResource(node, ZERO_PART)

// ---------------------------------------------------------------------------
// Emancipation
// ---------------------------------------------------------------------------

/**
 * Roles that, held by anyone on a registry's ROOT_RESOURCE, mean that registry
 * is **not emancipated** — someone can still reach into every name it holds.
 *
 * This matters more for Recall than it looks. A collection's own subregistry holds
 * every subscriber's `sub-<addr>` name. If the publisher keeps `ROLE_UNREGISTER`
 * on the root resource, they can delete a paying subscriber's live subscription
 * mid-term; with `ROLE_SET_RESOLVER` they can repoint it. Either one turns
 * "holding a live subname is the subscription" into "holding a live subname
 * until the publisher decides otherwise", which is a different product.
 *
 * `ROLE_REGISTRAR` and `ROLE_RENEW` are deliberately absent: a registrar has to
 * hold them to mint and extend names, and neither can take an existing name
 * away from its owner.
 */
export const DANGEROUS_ROOT_ROLES = {
  /** Can repoint any name's resolver. */
  SET_RESOLVER: RegistryRoles.SET_RESOLVER,
  /** Can repoint any name's child registry. */
  SET_SUBREGISTRY: RegistryRoles.SET_SUBREGISTRY,
  /** Can delete any name outright. */
  UNREGISTER: RegistryRoles.UNREGISTER,
  /** Admin variants — the power to re-grant the above. */
  SET_RESOLVER_ADMIN: RegistryRolesAdmin.SET_RESOLVER,
  SET_SUBREGISTRY_ADMIN: RegistryRolesAdmin.SET_SUBREGISTRY,
  UNREGISTER_ADMIN: RegistryRolesAdmin.UNREGISTER,
  /** Can swap the implementation for one that ignores all of the above. */
  UPGRADE: RegistryRoles.UPGRADE,
  UPGRADE_ADMIN: RegistryRolesAdmin.UPGRADE,
  /** Can move tokens out from under their owners. */
  CAN_TRANSFER_ADMIN: RegistryRolesAdmin.CAN_TRANSFER,
} as const

/** Every dangerous root role as one bitmap. */
export const DANGEROUS_ROOT_BITMAP = combineRoles(
  ...Object.values(DANGEROUS_ROOT_ROLES),
)

/**
 * The root bitmap a collection subregistry should be initialised with.
 *
 * **Both halves of each role are listed deliberately.** `withAdminRolesApplied`
 * describes a transformation the contract applies in some paths, but
 * `UserRegistry.initialize` does not: it calls `_grantRoles`, which simply ORs
 * the bitmap in. Granting only the admin halves produces an account that can
 * *delegate* registering and renewing but cannot do either itself — which
 * silently breaks opening a proposal, since that registers a name.
 *
 * `SET_PARENT` is included because the Universal Resolver's canonical walk
 * verifies a registry's backward pointer; without it `findCanonicalRegistry`
 * returns zero for the collection. It is not a dangerous role — the walk checks both
 * directions, so a bogus parent only breaks the setter's own resolution.
 *
 * Everything that could reach into a subscription already sold is still absent.
 */
export const EMANCIPATED_REGISTRY_ROLES = combineRoles(
  RegistryRoles.REGISTRAR,
  RegistryRolesAdmin.REGISTRAR,
  RegistryRoles.RENEW,
  RegistryRolesAdmin.RENEW,
  RegistryRoles.SET_PARENT,
  RegistryRolesAdmin.SET_PARENT,
)

/**
 * Which dangerous roles a bitmap contains, by name.
 *
 * Accepts either a grant bitmap or a `roleCount` bitmap — counts are normalised
 * first, so a role held by several accounts is still detected.
 */
export function dangerousRolesIn(roleBitmap: bigint): string[] {
  const held = rolesFromCounts(roleBitmap)
  return Object.entries(DANGEROUS_ROOT_ROLES)
    .filter(([, role]) => (held & role) !== 0n)
    .map(([name]) => name)
}

/**
 * True when a root-resource bitmap leaves the registry emancipated.
 *
 * Note this checks a *bitmap*, not a registry. A full check also requires that
 * the registry is a verified implementation and that no other account holds
 * these roles — see `assertEmancipated` in `scripts/deploy-collection.ts`, which
 * reads `roleCount(ROOT_RESOURCE)` on chain.
 */
export const isEmancipatedBitmap = (roleBitmap: bigint): boolean =>
  (rolesFromCounts(roleBitmap) & DANGEROUS_ROOT_BITMAP) === 0n
