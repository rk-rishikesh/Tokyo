/**
 * M1: deploy a collection.
 *
 * Creates the on-chain half of a Recall collection and publishes its first version:
 *
 *   1. ensure `<publisher>.eth` has a subregistry (deploy a UserRegistry proxy if not)
 *   2. deploy the collection's own subregistry and resolver, both via the Verifiable Factory
 *   3. register `<collection>` under the publisher, pointing at those two
 *   4. write the collection's config records
 *   5. deploy `SubscriptionRegistrar` and grant it the roles it needs
 *   6. encrypt and publish the seed document, and set `contenthash`
 *
 * Every contract call here uses a function present in a vendored ABI (rule 1).
 *
 * Run: pnpm deploy:collection --collection exploits --publisher auditor.eth
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  getAddress,
  http,
  namehash,
  parseUnits,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import {
  abis,
  addresses,
  RegistryRoles,
  RegistryRolesAdmin,
  ResolverRoles,
  ResolverRolesAdmin,
  STABLECOIN_DECIMALS,
  combineRoles,
  dangerousRolesIn,
  dnsEncode,
  EMANCIPATED_REGISTRY_ROLES,
  emptyCollection,
  generateContentKey,
  getEthRegistry,
  getSubregistry,
  keccakLabel,
  normalisePrivateKey,
  serialiseCollection,
  COLLECTION_RECORDS,
  type Collection,
} from '@recall/core'
import { createStorage } from '@recall/storage'

const { values } = parseArgs({
  options: {
    collection: { type: 'string' },
    publisher: { type: 'string' },
    price: { type: 'string', default: '10' },
    term: { type: 'string', default: String(30 * 24 * 60 * 60) },
    seed: { type: 'string' },
    storage: { type: 'string', default: process.env.RECALL_STORAGE ?? 'pinata' },
  },
})

const COLLECTION_LABEL = values.collection
const PUBLISHER_NAME = values.publisher
if (!COLLECTION_LABEL || !PUBLISHER_NAME) {
  console.error(
    'usage: pnpm deploy:collection --collection <label> --publisher <name.eth> [--price 10] [--term 2592000] [--seed entries.json]',
  )
  process.exit(1)
}

const COLLECTION_NAME = `${COLLECTION_LABEL}.${PUBLISHER_NAME}`
const RPC = process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'
const PRIVATE_KEY = normalisePrivateKey(process.env.PRIVATE_KEY)
if (!PRIVATE_KEY) {
  console.error(
    process.env.PRIVATE_KEY
      ? 'PRIVATE_KEY is not 32 bytes of hex — check for a truncated paste.'
      : 'PRIVATE_KEY is required (a test wallet, funded only for gas).',
  )
  process.exit(1)
}

const account = privateKeyToAccount(PRIVATE_KEY)
const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC) }) as PublicClient
const wallet = createWalletClient({ account, chain: sepolia, transport: http(RPC) }) as WalletClient

const step = (n: number, msg: string) => console.log(`\n[${n}] ${msg}`)
const info = (msg: string) => console.log(`    ${msg}`)

async function send(
  label: string,
  request: Parameters<WalletClient['writeContract']>[0],
): Promise<Hex> {
  const hash = await wallet.writeContract(request)
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`${label} reverted (${hash})`)
  info(`${label} ✓ ${hash}`)
  return hash
}

/** Deploy a UUPS proxy through the Verifiable Factory and return its address. */
async function deployProxy(
  implementation: Address,
  initCalldata: Hex,
  salt: bigint,
): Promise<Address> {
  const { result } = await publicClient.simulateContract({
    account,
    address: addresses.verifiableFactory,
    abi: abis.verifiableFactory,
    functionName: 'deployProxy',
    args: [implementation, salt, initCalldata],
  })
  await send('deployProxy', {
    account,
    chain: sepolia,
    address: addresses.verifiableFactory,
    abi: abis.verifiableFactory,
    functionName: 'deployProxy',
    args: [implementation, salt, initCalldata],
  } as never)
  return result as Address
}

/**
 * Check on chain that nobody holds a dangerous role on the registry's root
 * resource.
 *
 * The bitmap we initialised with is only half the story — roles can be granted
 * afterwards, and this runs after we have granted the registrar its own. It
 * reads `roleCount(ROOT_RESOURCE)`, whose nybbles hold the number of assignees
 * per role, and fails if any dangerous slot is non-zero.
 *
 * This is a warning rather than a revert: a publisher may have a considered
 * reason to keep a role. But it should never happen silently.
 */
async function assertEmancipated(registry: Address): Promise<void> {
  const counts = (await publicClient.readContract({
    address: registry,
    abi: abis.registry,
    functionName: 'roleCount',
    args: [0n], // ROOT_RESOURCE
  })) as bigint

  // Pass the raw counts: `dangerousRolesIn` normalises assignee counts itself.
  // Masking here first would drop any role held by more than one account.
  const held = dangerousRolesIn(counts)
  if (held.length === 0) {
    info('emancipated ✓ — no account can reach into a sold subscription')
    return
  }
  console.warn(
    `    WARNING: ${registry} is NOT emancipated.\n` +
      `    Dangerous roles still assigned on ROOT_RESOURCE: ${held.join(', ')}\n` +
      '    Whoever holds these can delete or repoint a subscription that has been\n' +
      '    paid for and has not expired.',
  )
}

/**
 * Refuse to start if the deploy would strand contracts.
 *
 * `pnpm preflight` covers more ground; these are the two conditions whose failure
 * is *expensive* rather than merely inconvenient, so they are re-checked here.
 */
async function assertCanDeploy(ethRegistry: Address): Promise<void> {
  const label = PUBLISHER_NAME!.replace(/\.eth$/, '')
  const labelhash = BigInt(keccakLabel(label))

  const expiry = (await publicClient.readContract({
    address: ethRegistry,
    abi: abis.ethRegistry,
    functionName: 'findExpiry',
    args: [label],
  })) as bigint
  if (expiry <= BigInt(Math.floor(Date.now() / 1000))) {
    throw new Error(
      `${PUBLISHER_NAME} is not registered (or has expired) on Sepolia. ` +
        'Register it before deploying a collection under it.',
    )
  }

  const owner = (await publicClient.readContract({
    address: ethRegistry,
    abi: abis.ethRegistry,
    functionName: 'getOwner',
    args: [labelhash],
  })) as Address
  if (getAddress(owner) !== getAddress(account.address)) {
    throw new Error(
      `${PUBLISHER_NAME} is owned by ${owner}, not by the deploying wallet ${account.address}.`,
    )
  }

  const canSetSubregistry = (await publicClient.readContract({
    address: ethRegistry,
    abi: abis.ethRegistry,
    functionName: 'hasRoles',
    args: [labelhash, combineRoles(RegistryRoles.SET_SUBREGISTRY), account.address],
  })) as boolean
  if (!canSetSubregistry) {
    throw new Error(
      `The deploying wallet lacks ROLE_SET_SUBREGISTRY on ${PUBLISHER_NAME}, so step 1 ` +
        'would revert after the registry proxy had already been paid for.',
    )
  }

  info('preflight: name owned, subregistry writable ✓')
}

async function main() {
  console.log(`\nRecall — deploying ${COLLECTION_NAME}`)
  console.log(`  publisher wallet: ${account.address}`)
  console.log(`  rpc:              ${RPC}`)

  const ethRegistry = await getEthRegistry(publicClient)
  info(`.eth registry:    ${ethRegistry}`)

  // Checked before anything is sent. Step 1 points the publisher's name at a new
  // subregistry; if that reverts we would already have paid to deploy a proxy
  // that nothing references and that this script will not pick up on a re-run.
  await assertCanDeploy(ethRegistry)

  // ---------------------------------------------------------------- 1
  step(1, `Ensuring ${PUBLISHER_NAME} has a subregistry`)
  const publisherLabel = PUBLISHER_NAME!.replace(/\.eth$/, '')
  let publisherRegistry = await getSubregistry(publicClient, ethRegistry, publisherLabel)

  if (BigInt(publisherRegistry) === 0n) {
    info('none set — deploying a UserRegistry proxy for the publisher')
    const init = encodeFunctionData({
      abi: abis.registry,
      functionName: 'initialize',
      args: [
        account.address,
        combineRoles(
          RegistryRoles.REGISTRAR,
          RegistryRolesAdmin.REGISTRAR,
          RegistryRoles.RENEW,
          RegistryRolesAdmin.RENEW,
          RegistryRoles.SET_SUBREGISTRY,
          RegistryRolesAdmin.SET_SUBREGISTRY,
          RegistryRoles.SET_RESOLVER,
          RegistryRolesAdmin.SET_RESOLVER,
          RegistryRoles.UNREGISTER,
          RegistryRolesAdmin.UNREGISTER,
        ),
      ],
    })
    publisherRegistry = await deployProxy(addresses.userRegistryImpl, init, BigInt(Date.now()))
    info(`publisher registry: ${publisherRegistry}`)

    await send('setSubregistry(publisher)', {
      account,
      chain: sepolia,
      address: ethRegistry,
      abi: abis.ethRegistry,
      functionName: 'setSubregistry',
      args: [BigInt(keccakLabel(publisherLabel)), publisherRegistry],
    } as never)
  } else {
    info(`already set: ${publisherRegistry}`)
  }

  // ---------------------------------------------------------------- 2
  step(2, 'Deploying the collection subregistry and resolver')

  // The collection subregistry is initialised **emancipated**: the publisher gets the
  // admin halves of REGISTRAR and RENEW (which imply the regular halves, so they
  // can mint names and delegate both to the registrar) and nothing else.
  //
  // Deliberately withheld on the root resource: SET_RESOLVER, SET_SUBREGISTRY and
  // UNREGISTER. This registry holds every subscriber's `sub-<addr>` name. A
  // publisher holding those could delete or repoint a subscription that someone
  // has paid for and that has not expired — which would make "holding a live
  // subname is the subscription" untrue. See DANGEROUS_ROOT_ROLES in core.
  const registryInit = encodeFunctionData({
    abi: abis.registry,
    functionName: 'initialize',
    args: [account.address, EMANCIPATED_REGISTRY_ROLES],
  })
  const collectionRegistry = await deployProxy(
    addresses.userRegistryImpl,
    registryInit,
    BigInt(Date.now()) + 1n,
  )
  info(`collection subregistry: ${collectionRegistry}`)

  // The publisher gets both the regular and admin halves of every record role.
  // The admin half is what lets them later delegate a single proposal key to a
  // contributor via authorizeDataRoles.
  const resolverInit = encodeFunctionData({
    abi: abis.resolver,
    functionName: 'initialize',
    args: [
      account.address,
      combineRoles(
        ResolverRoles.SET_CONTENTHASH,
        ResolverRolesAdmin.SET_CONTENTHASH,
        ResolverRoles.SET_TEXT,
        ResolverRolesAdmin.SET_TEXT,
        ResolverRoles.SET_DATA,
        ResolverRolesAdmin.SET_DATA,
        ResolverRoles.SET_PUBKEY,
        ResolverRolesAdmin.SET_PUBKEY,
        ResolverRoles.SET_ADDR,
        ResolverRolesAdmin.SET_ADDR,
        ResolverRoles.CLEAR,
        ResolverRolesAdmin.CLEAR,
      ),
      [],
    ],
  })
  const collectionResolver = await deployProxy(
    addresses.permissionedResolverImpl,
    resolverInit,
    BigInt(Date.now()) + 2n,
  )
  info(`collection resolver:    ${collectionResolver}`)

  // ---------------------------------------------------------------- 3
  step(3, `Registering ${COLLECTION_NAME}`)
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60)
  await send('register(collection)', {
    account,
    chain: sepolia,
    address: publisherRegistry,
    abi: abis.registry,
    functionName: 'register',
    args: [
      COLLECTION_LABEL,
      account.address,
      collectionRegistry,
      collectionResolver,
      combineRoles(
        RegistryRoles.SET_RESOLVER,
        RegistryRolesAdmin.SET_RESOLVER,
        RegistryRoles.SET_SUBREGISTRY,
        RegistryRolesAdmin.SET_SUBREGISTRY,
        RegistryRoles.RENEW,
        RegistryRolesAdmin.RENEW,
      ),
      expiry,
    ],
  } as never)

  const collectionNode = namehash(COLLECTION_NAME)
  info(`namehash: ${collectionNode}`)

  // The backward pointer. The Universal Resolver's canonical walk verifies that a
  // registry claims the parent that points at it, so without this
  // `findCanonicalRegistry` returns zero and anything relying on the canonical
  // chain silently sees no registry at all.
  await send('setParent(collection registry)', {
    account,
    chain: sepolia,
    address: collectionRegistry,
    abi: abis.registry,
    functionName: 'setParent',
    args: [publisherRegistry, COLLECTION_LABEL],
  } as never)

  // ---------------------------------------------------------------- 4
  step(4, 'Writing collection configuration records')
  const priceUnits = parseUnits(values.price!, STABLECOIN_DECIMALS)
  const records: [string, string][] = [
    [COLLECTION_RECORDS.schema, 'recall/entry-list/1'],
    [COLLECTION_RECORDS.price, `${priceUnits}:${values.term}`],
    [COLLECTION_RECORDS.storage, values.storage!],
  ]
  for (const [key, value] of records) {
    await send(`setText(${key})`, {
      account,
      chain: sepolia,
      address: collectionResolver,
      abi: abis.resolver,
      functionName: 'setText',
      args: [collectionNode, key, value],
    } as never)
  }

  // ---------------------------------------------------------------- 5
  step(5, 'Deploying SubscriptionRegistrar')
  const artifact = JSON.parse(
    readFileSync(
      new URL('../engine/contracts/out/SubscriptionRegistrar.sol/SubscriptionRegistrar.json', import.meta.url),
      'utf8',
    ),
  ) as { abi: unknown[]; bytecode: { object: Hex } }

  const registrarHash = await wallet.deployContract({
    account,
    chain: sepolia,
    abi: artifact.abi as never,
    bytecode: artifact.bytecode.object,
    args: [
      collectionRegistry,
      addresses.stablecoin,
      account.address,
      collectionResolver,
      collectionNode,
      priceUnits,
      BigInt(values.term!),
    ],
  } as never)
  const registrarReceipt = await publicClient.waitForTransactionReceipt({ hash: registrarHash })
  const registrar = registrarReceipt.contractAddress
  if (!registrar) throw new Error('SubscriptionRegistrar deployment produced no address')
  info(`registrar: ${registrar}`)

  // Advertise the registrar on the collection itself. Without this a subscriber has
  // no way to find the contract that sells them access, and the address ends up
  // being passed around by hand.
  await send('setText(recall.registrar)', {
    account,
    chain: sepolia,
    address: collectionResolver,
    abi: abis.resolver,
    functionName: 'setText',
    args: [collectionNode, COLLECTION_RECORDS.registrar, registrar],
  } as never)

  step(6, 'Granting the registrar its roles')
  // On the subregistry: mint and renew subscription names.
  await send('grantRootRoles(registry)', {
    account,
    chain: sepolia,
    address: collectionRegistry,
    abi: abis.registry,
    functionName: 'grantRootRoles',
    args: [combineRoles(RegistryRoles.REGISTRAR, RegistryRoles.RENEW), registrar],
  } as never)

  // On the resolver: hand each subscriber write access to their own pubkey
  // record. Granting a role requires holding its admin counterpart.
  await send('grantRootRoles(resolver)', {
    account,
    chain: sepolia,
    address: collectionResolver,
    abi: abis.resolver,
    functionName: 'grantRootRoles',
    args: [ResolverRolesAdmin.SET_PUBKEY, registrar],
  } as never)

  // ---------------------------------------------------------------- 7
  step(7, 'Publishing the seed document')
  const seed: Collection = values.seed
    ? (JSON.parse(readFileSync(values.seed, 'utf8')) as Collection)
    : emptyCollection(COLLECTION_NAME)
  seed.collection = COLLECTION_NAME

  const contentKey = generateContentKey()
  const storage = createStorage(values.storage as 'pinata' | 'swarm' | 'memory')
  const ref = await storage.put(serialiseCollection(seed), { collection: COLLECTION_NAME, contentKey })
  const contenthash = storage.toContenthash(ref)
  info(`ref:         ${ref.ref}`)
  info(`contenthash: ${contenthash}`)

  await send('setContenthash', {
    account,
    chain: sepolia,
    address: collectionResolver,
    abi: abis.resolver,
    functionName: 'setContenthash',
    args: [collectionNode, contenthash],
  } as never)

  if (ref.kind === 'swarm' && ref.actHistory && ref.actPublisher) {
    for (const [key, value] of [
      ['recall.actHistory', ref.actHistory],
      ['recall.actPublisher', ref.actPublisher],
    ] as const) {
      await send(`setText(${key})`, {
        account,
        chain: sepolia,
        address: collectionResolver,
        abi: abis.resolver,
        functionName: 'setText',
        args: [collectionNode, key, value],
      } as never)
    }
  }

  // ---------------------------------------------------------------- 8
  step(8, 'Verifying the collection subregistry is emancipated')
  await assertEmancipated(collectionRegistry)

  // ----------------------------------------------------------------
  console.log(`\nDeployed ${COLLECTION_NAME}\n`)
  console.log(
    JSON.stringify(
      {
        collection: COLLECTION_NAME,
        node: collectionNode,
        publisherRegistry,
        collectionRegistry,
        collectionResolver,
        registrar,
        stablecoin: addresses.stablecoin,
        contenthash,
        ref: ref.ref,
        storage: values.storage,
        entries: seed.entries.length,
        // The content key is the one secret here. It is printed once, not stored.
        contentKey: `0x${Buffer.from(contentKey).toString('hex')}`,
      },
      null,
      2,
    ),
  )
  console.log(
    '\nSave the contentKey somewhere safe — it is required to publish updates and to ' +
      'wrap keys for subscribers, and it is not written to chain.\n',
  )
}

main().catch((e) => {
  console.error('\ndeploy-collection failed:', e)
  process.exit(1)
})
