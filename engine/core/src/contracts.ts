/**
 * Pinned ENSv2 Sepolia deployment.
 *
 * ABIs come from the vendored artifacts in `engine/core/abis/`, which are the
 * only source of truth for what may be called (rule 1).
 *
 * Addresses are split into two kinds, and the split matters:
 *
 *   - **Pinned.** The Universal Resolver entrypoint and the implementation /
 *     factory contracts we deploy against. Verified to have code on Sepolia.
 *   - **Discovered.** The root registry and the `.eth` registry, read from the
 *     Universal Resolver at runtime. These have already been redeployed at
 *     least once; pinning them is how a build silently starts talking to a dead
 *     registry. See CONTRACTS.md.
 */
import UniversalResolverV2 from '../abis/UniversalResolverV2.json' with { type: 'json' }
import UpgradableUniversalResolverProxy from '../abis/UpgradableUniversalResolverProxy.json' with { type: 'json' }
import ETHRegistry from '../abis/ETHRegistry.json' with { type: 'json' }
import ETHRegistrar from '../abis/ETHRegistrar.json' with { type: 'json' }
import UserRegistryImpl from '../abis/UserRegistryImpl.json' with { type: 'json' }
import PermissionedResolverImpl from '../abis/PermissionedResolverImpl.json' with { type: 'json' }
import VerifiableFactory from '../abis/VerifiableFactory.json' with { type: 'json' }
import MockUSDC from '../abis/MockUSDC.json' with { type: 'json' }
import type { Abi, Address } from 'viem'

export const SEPOLIA_CHAIN_ID = 11155111

/**
 * The Universal Resolver we read through.
 *
 * Pinned to the **documented** UniversalResolverV2, not the vanity proxy at
 * 0xeEeE…EeEe. On 15 September 2026 the proxy was re-pointed at a registry set
 * (root 0x0F62…, eth 0x1BD2…) that is not in the ENS documentation's Sepolia
 * table and does not contain names registered through the documented
 * ETHRegistrar — including ours. The docs table is this project's declared
 * authority (CONTRACTS.md §1), and the documented UR still resolves the
 * documented registries, so that is what we pin. Root and .eth registries are
 * still discovered from whichever UR is pinned, never hard-coded.
 */
export const UNIVERSAL_RESOLVER = UniversalResolverV2.address as Address

export const abis = {
  universalResolver: UniversalResolverV2.abi as Abi,
  /** `UserRegistry` — also the shape of the root and `.eth` registries. */
  registry: UserRegistryImpl.abi as Abi,
  ethRegistry: ETHRegistry.abi as Abi,
  ethRegistrar: ETHRegistrar.abi as Abi,
  resolver: PermissionedResolverImpl.abi as Abi,
  verifiableFactory: VerifiableFactory.abi as Abi,
  erc20: MockUSDC.abi as Abi,
} as const

/** Addresses safe to pin. Each is checked in CONTRACTS.md. */
export const addresses = {
  universalResolverProxy: UpgradableUniversalResolverProxy.address as Address,
  /** Deploys the collection's subregistry and resolver proxies. */
  verifiableFactory: VerifiableFactory.address as Address,
  /** Implementation proxied for a collection's own subregistry. */
  userRegistryImpl: UserRegistryImpl.address as Address,
  /** Implementation proxied for a collection's resolver. */
  permissionedResolverImpl: PermissionedResolverImpl.address as Address,
  /** Test stablecoin that pays for `.eth` registration on Sepolia. */
  stablecoin: MockUSDC.address as Address,
  /**
   * The live `.eth` registrar — where a second-level name is bought.
   *
   * Not in the published deployments table, so it was discovered instead: it is
   * the sender of every `LabelRegistered` event on the live `.eth` registry, and
   * all 23 functions of the vendored ABI are present in its bytecode. Registering
   * through it grants the owner SET_SUBREGISTRY and SET_RESOLVER, which is what
   * attaching a namespace's own registry and resolver needs.
   */
  ethRegistrar: ETHRegistrar.address as Address,
} as const

/**
 * Decimals of the Sepolia test stablecoin. Verified on-chain rather than
 * assumed — a wrong value here silently misprices every subscription.
 */
export const STABLECOIN_DECIMALS = 6

/** Interface IDs, from the `@dev Interface selector` tags on the interfaces. */
export const INTERFACE_IDS = {
  IRegistry: '0x51f67f40',
  IStandardRegistry: '0xb844ab6c',
  ITokenizedRegistry: '0x91b3c037',
  ITemporalRegistry: '0x6f537c72',
  IPermissionedRegistry: '0x6be50c69',
  IPermissionedResolver: '0x91413117',
} as const
