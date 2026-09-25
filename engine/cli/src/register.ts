/**
 * `knowledge init <name> --register` — give a namespace an ENS V2 home.
 *
 * Two cases:
 *
 *   cancer-research.eth         a top-level name: ETH registrar commit → wait → reveal,
 *                               then a UserRegistry (so it can have children) and a
 *                               PermissionedResolver, both via the Verifiable Factory.
 *   trials.cancer-research.eth  a child: the wallet must own the parent. Deploy the
 *                               child's registry + resolver, register the label under the
 *                               parent's registry, setParent for the canonical walk.
 *
 * Every namespace gets its own registry, because hierarchy is the point (PRD §6):
 * trials.cancer-research.eth can later own phase3.trials.cancer-research.eth. Every contract
 * call uses a function present in a vendored ABI.
 */
import { randomBytes } from 'node:crypto'
import {
  encodeFunctionData, formatUnits, getAddress, toHex, zeroAddress, zeroHash,
  type Address, type Hex, type PublicClient, type WalletClient,
} from 'viem'
import { sepolia } from 'viem/chains'
import {
  abis, addresses, RegistryRoles, RegistryRolesAdmin, ResolverRoles, ResolverRolesAdmin, STABLECOIN_DECIMALS,
  combineRoles, findOwner, findResolver, getEthRegistry, getSubregistry, keccakLabel, splitName,
} from '@knowledge01/core'

export type RegisterLog = (msg: string) => void
export type Registered = { resolver: Address; registry: Address; alreadyRegistered: boolean }

const OWNER_REGISTRY_ROLES = combineRoles(
  RegistryRoles.REGISTRAR, RegistryRolesAdmin.REGISTRAR,
  RegistryRoles.RENEW, RegistryRolesAdmin.RENEW,
  RegistryRoles.SET_SUBREGISTRY, RegistryRolesAdmin.SET_SUBREGISTRY,
  RegistryRoles.SET_RESOLVER, RegistryRolesAdmin.SET_RESOLVER,
  RegistryRoles.UNREGISTER, RegistryRolesAdmin.UNREGISTER,
  // Needed for setParent, which the canonical-registry walk relies on. Left out once; the
  // registry behind worldhistory.eth has no parent link as a result.
  RegistryRoles.SET_PARENT, RegistryRolesAdmin.SET_PARENT,
)
const OWNER_RESOLVER_ROLES = combineRoles(
  ResolverRoles.SET_CONTENTHASH, ResolverRolesAdmin.SET_CONTENTHASH,
  ResolverRoles.SET_TEXT, ResolverRolesAdmin.SET_TEXT,
  ResolverRoles.CLEAR, ResolverRolesAdmin.CLEAR,
)

export async function registerNamespace(name: string, publicClient: PublicClient, wallet: WalletClient, log: RegisterLog = () => {}): Promise<Registered> {
  const account = wallet.account
  if (!account) throw new Error('wallet has no account')
  if (!name.endsWith('.eth')) throw new Error('a namespace must be a .eth name (history.eth, india.history.eth)')

  // Is the name itself registered? (findResolver alone is not enough: a child with no
  // record of its own resolves through its parent's resolver, which looks "taken".)
  const owner = await findOwner(publicClient, name).catch(() => zeroAddress)
  if (BigInt(owner) !== 0n) {
    if (getAddress(owner) !== getAddress(account.address)) {
      throw new Error(`${name} is already registered to ${owner}. Pick another name, e.g. a child of one you own.`)
    }
    const existing = await findResolver(publicClient, name)
    log(`${name} is already ours; resolver ${existing.resolver}`)
    const { label, parent } = splitName(name)
    const parentRegistry = parent === 'eth' ? await getEthRegistry(publicClient) : await registryOf(parent, publicClient)
    const registry = await getSubregistry(publicClient, parentRegistry, label)
    return { resolver: existing.resolver, registry, alreadyRegistered: true }
  }

  const send = async (label: string, request: Record<string, unknown>): Promise<Hex> => {
    const hash = await wallet.writeContract(request as never)
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') throw new Error(`${label} reverted (${hash})`)
    log(`${label} ✓ ${hash}`)
    return hash
  }
  const deployProxy = async (implementation: Address, initCalldata: Hex, salt: bigint): Promise<Address> => {
    const { result } = await publicClient.simulateContract({
      account, address: addresses.verifiableFactory, abi: abis.verifiableFactory, functionName: 'deployProxy', args: [implementation, salt, initCalldata],
    })
    await send('deployProxy', { account, chain: sepolia, address: addresses.verifiableFactory, abi: abis.verifiableFactory, functionName: 'deployProxy', args: [implementation, salt, initCalldata] })
    return result as Address
  }
  const deployPair = async (): Promise<{ registry: Address; resolver: Address }> => {
    const registry = await deployProxy(addresses.userRegistryImpl, encodeFunctionData({ abi: abis.registry, functionName: 'initialize', args: [account.address, OWNER_REGISTRY_ROLES] }), BigInt(Date.now()))
    log(`registry: ${registry}`)
    const resolver = await deployProxy(addresses.permissionedResolverImpl, encodeFunctionData({ abi: abis.resolver, functionName: 'initialize', args: [account.address, OWNER_RESOLVER_ROLES, []] }), BigInt(Date.now()) + 1n)
    log(`resolver: ${resolver}`)
    return { registry, resolver }
  }

  const { label, parent } = splitName(name)
  const ethRegistry = await getEthRegistry(publicClient)

  // The registrar must register into the registry our resolver reads, or the name
  // is paid for and invisible. This has happened once; never again silently.
  const registrarRegistry = (await publicClient.readContract({ address: addresses.ethRegistrar, abi: abis.ethRegistrar, functionName: 'ETH_REGISTRY' })) as Address
  if (getAddress(registrarRegistry) !== getAddress(ethRegistry)) {
    throw new Error(`pinned ETHRegistrar registers into ${registrarRegistry} but the pinned Universal Resolver reads ${ethRegistry}. Re-pin against the ENS docs deployments table before registering anything.`)
  }

  // ---- top-level: cancer-research.eth ----
  if (parent === 'eth') {
    const registrar = addresses.ethRegistrar
    const labelhash = BigInt(keccakLabel(label))
    const ethOwner = (await publicClient.readContract({ address: ethRegistry, abi: abis.ethRegistry, functionName: 'getOwner', args: [labelhash] }).catch(() => zeroAddress)) as Address
    if (BigInt(ethOwner) === 0n) {
      const available = (await publicClient.readContract({ address: registrar, abi: abis.ethRegistrar, functionName: 'isAvailable', args: [label] })) as boolean
      if (!available) throw new Error(`${name} is not available and not owned by this wallet`)
      const duration = BigInt(365 * 24 * 60 * 60)
      const [base, premium] = (await publicClient.readContract({ address: registrar, abi: abis.ethRegistrar, functionName: 'getRegisterPrice', args: [label, duration, addresses.stablecoin] })) as [bigint, bigint]
      const price = base + premium
      log(`${name} is available — ${formatUnits(price, STABLECOIN_DECIMALS)} test USDC for one year`)
      let balance = (await publicClient.readContract({ address: addresses.stablecoin, abi: abis.erc20, functionName: 'balanceOf', args: [account.address] })) as bigint
      if (balance < price) {
        await send('mint test USDC', { account, chain: sepolia, address: addresses.stablecoin, abi: abis.erc20, functionName: 'mint', args: [account.address, price * 100n] })
        balance += price * 100n
      }
      const allowance = (await publicClient.readContract({ address: addresses.stablecoin, abi: abis.erc20, functionName: 'allowance', args: [account.address, registrar] })) as bigint
      if (allowance < price) await send('approve', { account, chain: sepolia, address: addresses.stablecoin, abi: abis.erc20, functionName: 'approve', args: [registrar, balance] })

      const secret = toHex(randomBytes(32)) as Hex
      const commitment = (await publicClient.readContract({ address: registrar, abi: abis.ethRegistrar, functionName: 'makeCommitment', args: [label, account.address, secret, zeroAddress, zeroAddress, duration, zeroHash] })) as Hex
      await send('commit', { account, chain: sepolia, address: registrar, abi: abis.ethRegistrar, functionName: 'commit', args: [commitment] })
      const minAge = (await publicClient.readContract({ address: registrar, abi: abis.ethRegistrar, functionName: 'MIN_COMMITMENT_AGE' })) as bigint
      log(`waiting ${minAge}s commitment age (front-running protection)`)
      await new Promise((r) => setTimeout(r, Number(minAge) * 1000 + 15_000))
      await send('register', { account, chain: sepolia, address: registrar, abi: abis.ethRegistrar, functionName: 'register', args: [label, account.address, secret, zeroAddress, zeroAddress, duration, addresses.stablecoin, zeroHash] })
    } else if (getAddress(ethOwner) !== getAddress(account.address)) {
      throw new Error(`${name} is owned by ${ethOwner}, not by this wallet (${account.address})`)
    } else {
      log(`${name} is already owned by this wallet`)
    }
    const { registry, resolver } = await deployPair()
    await send('setSubregistry', { account, chain: sepolia, address: ethRegistry, abi: abis.ethRegistry, functionName: 'setSubregistry', args: [labelhash, registry] })
    await send('setResolver', { account, chain: sepolia, address: ethRegistry, abi: abis.ethRegistry, functionName: 'setResolver', args: [labelhash, resolver] })
    await send('setParent', { account, chain: sepolia, address: registry, abi: abis.registry, functionName: 'setParent', args: [ethRegistry, label] })
    return { registry, resolver, alreadyRegistered: false }
  }

  // ---- child: trials.cancer-research.eth under cancer-research.eth ----
  const parentRegistry = await registryOf(parent, publicClient)
  const { registry, resolver } = await deployPair()
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60)
  await send(`register(${name})`, {
    account, chain: sepolia, address: parentRegistry, abi: abis.registry, functionName: 'register',
    args: [label, account.address, registry, resolver, combineRoles(RegistryRoles.SET_RESOLVER, RegistryRolesAdmin.SET_RESOLVER, RegistryRoles.SET_SUBREGISTRY, RegistryRolesAdmin.SET_SUBREGISTRY, RegistryRoles.RENEW, RegistryRolesAdmin.RENEW), expiry],
  })
  await send('setParent', { account, chain: sepolia, address: registry, abi: abis.registry, functionName: 'setParent', args: [parentRegistry, label] })
  return { registry, resolver, alreadyRegistered: false }
}

/** The registry that holds `name`'s children, walking down from .eth. */
async function registryOf(name: string, publicClient: PublicClient): Promise<Address> {
  const labels = name.replace(/\.eth$/, '').split('.').reverse()
  let registry = await getEthRegistry(publicClient)
  for (const label of labels) {
    const next = await getSubregistry(publicClient, registry, label)
    if (BigInt(next) === 0n) throw new Error(`${name} has no registry for children — run \`knowledge init ${name} --register\` first`)
    registry = next
  }
  return registry
}
