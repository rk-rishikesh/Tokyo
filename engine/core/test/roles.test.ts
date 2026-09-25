import { describe, expect, it } from 'vitest'
import {
  ADMIN_ROLES,
  ALL_ROLES,
  RegistryRoles,
  RegistryRolesAdmin,
  ResolverRoles,
  combineRoles,
  dataKeyResource,
  decodeRoleSlots,
  encodeRoleSlots,
  isValidRoleBitmap,
  nodeResource,
  partHashString,
  resolverResource,
  roleCount,
  withAdminRolesApplied,
  ZERO_PART,
  dangerousRolesIn,
  EMANCIPATED_REGISTRY_ROLES,
  isEmancipatedBitmap,
  rolesFromCounts,
} from '../src/roles.js'
import { keccak256, namehash, toHex, encodeAbiParameters } from 'viem'

describe('EAC bitmaps', () => {
  it('ALL_ROLES sets bit 0 of every nybble', () => {
    for (let i = 0; i < 64; i++) {
      expect((ALL_ROLES >> BigInt(i * 4)) & 0xfn).toBe(1n)
    }
  })

  it('ADMIN_ROLES covers only the upper 128 bits', () => {
    expect(ADMIN_ROLES & ((1n << 128n) - 1n)).toBe(0n)
    expect(ADMIN_ROLES >> 128n).toBe(ALL_ROLES >> 128n)
  })

  it('admin roles sit exactly 128 bits above their regular counterpart', () => {
    expect(RegistryRolesAdmin.REGISTRAR).toBe(RegistryRoles.REGISTRAR << 128n)
    expect(RegistryRolesAdmin.SET_RESOLVER).toBe(RegistryRoles.SET_RESOLVER << 128n)
  })

  it('round-trips slot indices through encode/decode', () => {
    const slots = [0, 4, 9, 31, 36, 63]
    expect(decodeRoleSlots(encodeRoleSlots(slots))).toEqual(slots)
  })

  it('decodes the slots of a combined bitmap', () => {
    const bitmap = combineRoles(
      RegistryRoles.REGISTRAR,
      RegistryRoles.SET_RESOLVER,
      RegistryRoles.RENEW,
    )
    // nybble 0 (REGISTRAR), 4 (RENEW), 6 (SET_RESOLVER)
    expect(decodeRoleSlots(bitmap)).toEqual([0, 4, 6])
  })

  it('reads assignee counts out of a nybble', () => {
    const twoAssignees = 2n << 0n // nybble 0 holding a count of 2
    expect(roleCount(twoAssignees, 0)).toBe(2)
  })

  it('withAdminRolesApplied makes an admin role imply its regular role', () => {
    const applied = withAdminRolesApplied(RegistryRolesAdmin.REGISTRAR)
    expect(applied & RegistryRoles.REGISTRAR).toBe(RegistryRoles.REGISTRAR)
    expect(applied & RegistryRolesAdmin.REGISTRAR).toBe(RegistryRolesAdmin.REGISTRAR)
  })

  it('rejects bitmaps with bits outside nybble position 0', () => {
    expect(isValidRoleBitmap(RegistryRoles.REGISTRAR)).toBe(true)
    expect(isValidRoleBitmap(0b10n)).toBe(false)
  })
})

describe('resolver resources', () => {
  it('matches the contract: keccak256(abi.encode(node, part))', () => {
    const node = namehash('exploits.auditor.eth')
    const part = partHashString('candidateRef')
    const expected = BigInt(
      keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [node, part])),
    )
    expect(resolverResource(node, part)).toBe(expected)
  })

  it('partHash of a string is keccak of its utf-8 bytes', () => {
    expect(partHashString('candidateRef')).toBe(keccak256(toHex('candidateRef')))
  })

  it('resource(0, 0) short-circuits to the root resource', () => {
    expect(resolverResource(ZERO_PART, ZERO_PART)).toBe(0n)
  })

  it('scopes different keys on the same name to different resources', () => {
    const name = 'pr-1.exploits.auditor.eth'
    const node = namehash(name)
    expect(dataKeyResource(node, 'candidateRef')).not.toBe(dataKeyResource(node, 'parentRef'))
  })

  it('scopes the same key on different names to different resources', () => {
    const a = namehash('pr-1.exploits.auditor.eth')
    const b = namehash('pr-2.exploits.auditor.eth')
    expect(dataKeyResource(a, 'candidateRef')).not.toBe(dataKeyResource(b, 'candidateRef'))
  })

  it('separates the name-wide resource from any key resource', () => {
    const node = namehash('exploits.auditor.eth')
    expect(nodeResource(node)).not.toBe(dataKeyResource(node, 'candidateRef'))
  })
})

describe('emancipation', () => {
  it('grants both halves explicitly, because initialize does not imply them', () => {
    // UserRegistry.initialize calls _grantRoles, which ORs the bitmap in without
    // applying admin implication. Listing only the admin halves would produce an
    // account that can delegate registering but not register — which breaks
    // opening a proposal.
    expect(decodeRoleSlots(EMANCIPATED_REGISTRY_ROLES)).toEqual([0, 2, 4, 32, 34, 36])
  })

  it('lets the publisher actually register and renew, not merely delegate', () => {
    for (const role of [RegistryRoles.REGISTRAR, RegistryRoles.RENEW]) {
      expect(EMANCIPATED_REGISTRY_ROLES & role).toBe(role)
    }
  })

  it('includes SET_PARENT so canonical resolution works', () => {
    // Without the backward pointer, findCanonicalRegistry returns zero.
    expect(EMANCIPATED_REGISTRY_ROLES & RegistryRoles.SET_PARENT).toBe(RegistryRoles.SET_PARENT)
  })

  it('the collection-registry bitmap is emancipated', () => {
    expect(isEmancipatedBitmap(EMANCIPATED_REGISTRY_ROLES)).toBe(true)
    expect(dangerousRolesIn(EMANCIPATED_REGISTRY_ROLES)).toEqual([])
  })

  it('lets the registrar be delegated registrar and renew rights', () => {
    // Granting a role requires holding its admin counterpart.
    expect(EMANCIPATED_REGISTRY_ROLES & RegistryRolesAdmin.REGISTRAR).toBe(RegistryRolesAdmin.REGISTRAR)
    expect(EMANCIPATED_REGISTRY_ROLES & RegistryRolesAdmin.RENEW).toBe(RegistryRolesAdmin.RENEW)
  })

  it.each([
    ['SET_RESOLVER', RegistryRoles.SET_RESOLVER],
    ['SET_SUBREGISTRY', RegistryRoles.SET_SUBREGISTRY],
    ['UNREGISTER', RegistryRoles.UNREGISTER],
    ['UPGRADE', RegistryRoles.UPGRADE],
  ])('treats root %s as dangerous — it can reach into a sold subscription', (name, role) => {
    expect(isEmancipatedBitmap(role)).toBe(false)
    expect(dangerousRolesIn(role)).toContain(name)
  })

  it('treats the admin half of a dangerous role as dangerous too', () => {
    expect(isEmancipatedBitmap(RegistryRolesAdmin.UNREGISTER)).toBe(false)
  })

  it('treats CAN_TRANSFER_ADMIN as dangerous — it moves tokens from their owners', () => {
    expect(isEmancipatedBitmap(RegistryRolesAdmin.CAN_TRANSFER)).toBe(false)
  })

  it('does not flag registrar or renew, which cannot take a name away', () => {
    expect(
      isEmancipatedBitmap(combineRoles(RegistryRoles.REGISTRAR, RegistryRoles.RENEW)),
    ).toBe(true)
  })

  it('names every dangerous role present in a mixed bitmap', () => {
    // This is the bitmap deploy-collection.ts used before the ENS docs made the
    // emancipation requirement explicit.
    const unsafe = combineRoles(
      RegistryRoles.REGISTRAR,
      RegistryRolesAdmin.REGISTRAR,
      RegistryRoles.RENEW,
      RegistryRolesAdmin.RENEW,
      RegistryRoles.UNREGISTER,
      RegistryRolesAdmin.UNREGISTER,
      RegistryRoles.SET_RESOLVER,
      RegistryRolesAdmin.SET_RESOLVER,
      RegistryRoles.SET_SUBREGISTRY,
      RegistryRolesAdmin.SET_SUBREGISTRY,
    )
    expect(isEmancipatedBitmap(unsafe)).toBe(false)
    expect(dangerousRolesIn(unsafe).sort()).toEqual([
      'SET_RESOLVER',
      'SET_RESOLVER_ADMIN',
      'SET_SUBREGISTRY',
      'SET_SUBREGISTRY_ADMIN',
      'UNREGISTER',
      'UNREGISTER_ADMIN',
    ])
  })

  it('detects a dangerous role held by more than one account', () => {
    // roleCount() packs *assignee counts* per nybble, not flags. Two accounts
    // holding UNREGISTER is a count of 2 in nybble 3 — and `2 & 1` is zero, so
    // a naive mask reports the role as unheld exactly when it is held twice.
    const counts = 2n << 12n
    expect(counts & RegistryRoles.UNREGISTER).toBe(0n) // the trap
    expect(dangerousRolesIn(counts)).toContain('UNREGISTER')
    expect(isEmancipatedBitmap(counts)).toBe(false)
  })

  it('normalises every assignee count from 1 to 15', () => {
    for (let n = 1n; n <= 15n; n++) {
      expect(dangerousRolesIn(n << 12n)).toContain('UNREGISTER')
    }
    expect(dangerousRolesIn(0n << 12n)).toEqual([])
  })

  it('rolesFromCounts collapses counts to the unit mask the contract uses', () => {
    expect(rolesFromCounts(2n << 12n)).toBe(RegistryRoles.UNREGISTER)
    expect(rolesFromCounts(15n << 12n)).toBe(RegistryRoles.UNREGISTER)
    expect(rolesFromCounts(0n)).toBe(0n)
  })
})
