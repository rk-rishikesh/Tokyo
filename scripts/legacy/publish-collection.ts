/**
 * Publish (or re-publish) a collection's content and point the name at it.
 *
 * This is the second half of `deploy-collection.ts`, split out so it can be run on
 * its own. Two reasons that matters:
 *
 *   - **Resume.** The on-chain half of a deploy is not reversible; if the
 *     storage half fails, re-running the whole deploy would create a second set
 *     of contracts rather than repair the first. This finishes the job instead.
 *   - **Updates.** Publishing a new version is the normal, repeated operation —
 *     encrypt, store, move the pointer. It should not require a deploy script.
 *
 * The registry and resolver are discovered by walking the name, so there is
 * nothing to copy from a previous run except the content key.
 *
 * Run: pnpm publish:collection --collection exploits.recalltest.eth --seed seed.json
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import {
  createPublicClient,
  createWalletClient,
  http,
  namehash,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import {
  abis,
  emptyCollection,
  generateContentKey,
  getContenthash,
  getEthRegistry,
  getRegistryResolver,
  getSubregistry,
  getText,
  normalisePrivateKey,
  COLLECTION_RECORDS,
  serialiseCollection,
  splitName,
  validateCollection,
  type Collection,
} from '@knowledge01/core'
import { createStorage } from '@knowledge01/storage'

const { values } = parseArgs({
  options: {
    collection: { type: 'string' },
    seed: { type: 'string' },
    /** Public, readable without subscribing. */
    title: { type: 'string' },
    description: { type: 'string' },
    /** Hex content key. Omit to mint a fresh one (this re-keys the collection). */
    key: { type: 'string' },
    storage: { type: 'string' },
  },
})

if (!values.collection) {
  console.error('usage: pnpm publish:collection --collection <collection>.<publisher>.eth [--seed seed.json] [--key 0x…]')
  process.exit(1)
}
const COLLECTION = values.collection

const RPC = process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'
const PRIVATE_KEY = normalisePrivateKey(process.env.PRIVATE_KEY)
if (!PRIVATE_KEY) {
  console.error('PRIVATE_KEY is required (32 bytes of hex, with or without 0x).')
  process.exit(1)
}

const account = privateKeyToAccount(PRIVATE_KEY)
const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC) }) as PublicClient
const wallet = createWalletClient({ account, chain: sepolia, transport: http(RPC) }) as WalletClient

const step = (n: number, m: string) => console.log(`\n[${n}] ${m}`)
const info = (m: string) => console.log(`    ${m}`)

async function main() {
  console.log(`\nPublishing ${COLLECTION}\n  wallet: ${account.address}`)

  // ---------------------------------------------------------------- 1
  step(1, 'Locating the collection')
  // <label>.<publisher>.eth — the resolver lives on the publisher's registry.
  const { label, parent } = splitName(COLLECTION)
  const publisherLabel = splitName(parent).label

  const ethRegistry = await getEthRegistry(publicClient)
  const publisherRegistry = await getSubregistry(publicClient, ethRegistry, publisherLabel)
  if (BigInt(publisherRegistry) === 0n) {
    throw new Error(`${parent} has no subregistry — has the collection been deployed?`)
  }
  const resolver = (await getRegistryResolver(publicClient, publisherRegistry, label)) as Address
  if (BigInt(resolver) === 0n) {
    throw new Error(`${COLLECTION} has no resolver — has the collection been deployed?`)
  }
  info(`publisher registry: ${publisherRegistry}`)
  info(`collection resolver:     ${resolver}`)

  const storageKind =
    values.storage ?? (await getText(publicClient, COLLECTION, 'recall.storage')) ?? 'pinata'
  info(`storage:            ${storageKind}`)

  const current = await getContenthash(publicClient, COLLECTION).catch(() => '0x' as Hex)
  info(`current contenthash: ${current === '0x' ? '(unset)' : current}`)

  // ---------------------------------------------------------------- 2
  step(2, 'Preparing the document')
  const collection: Collection = values.seed
    ? (JSON.parse(readFileSync(values.seed, 'utf8')) as Collection)
    : emptyCollection(COLLECTION)
  collection.collection = COLLECTION
  validateCollection(collection)
  const bytes = serialiseCollection(collection)
  info(`${collection.entries.length} entries, ${bytes.length} bytes`)

  // ---------------------------------------------------------------- 3
  step(3, 'Encrypting and storing')
  const contentKey = values.key
    ? Uint8Array.from(Buffer.from(values.key.replace(/^0x/, ''), 'hex'))
    : generateContentKey()
  if (!values.key) {
    info('no --key given: minting a fresh content key (this re-keys the collection)')
  }
  if (contentKey.length !== 32) throw new Error('content key must be 32 bytes')

  const storage = createStorage(storageKind as 'pinata' | 'swarm' | 'memory')
  const ref = await storage.put(bytes, { collection: COLLECTION, contentKey })
  const contenthash = storage.toContenthash(ref)
  info(`ref:         ${ref.ref}`)
  info(`contenthash: ${contenthash}`)

  // ---------------------------------------------------------------- 4
  step(4, 'Pointing the name at it')
  const hash = await wallet.writeContract({
    account,
    chain: sepolia,
    address: resolver,
    abi: abis.resolver,
    functionName: 'setContenthash',
    args: [namehash(COLLECTION), contenthash],
  } as never)
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`setContenthash reverted (${hash})`)
  info(`setContenthash ✓ ${hash}`)

  if (ref.kind === 'swarm' && ref.actHistory && ref.actPublisher) {
    for (const [key, value] of [
      ['recall.actHistory', ref.actHistory],
      ['recall.actPublisher', ref.actPublisher],
    ] as const) {
      const h = await wallet.writeContract({
        account,
        chain: sepolia,
        address: resolver,
        abi: abis.resolver,
        functionName: 'setText',
        args: [namehash(COLLECTION), key, value],
      } as never)
      await publicClient.waitForTransactionReceipt({ hash: h })
      info(`setText(${key}) ✓`)
    }
  }

  // ---------------------------------------------------------------- 4b
  // The public description. Written as text records rather than into the
  // document, so somebody deciding whether to subscribe can read it first.
  const publicRecords = [
    ...(values.title ? [[COLLECTION_RECORDS.title, values.title] as const] : []),
    ...(values.description ? [[COLLECTION_RECORDS.description, values.description] as const] : []),
  ]
  if (publicRecords.length) {
    step(5, 'Publishing the public description')
    for (const [key, value] of publicRecords) {
      const h = await wallet.writeContract({
        account,
        chain: sepolia,
        address: resolver,
        abi: abis.resolver,
        functionName: 'setText',
        args: [namehash(COLLECTION), key, value],
      } as never)
      await publicClient.waitForTransactionReceipt({ hash: h })
      info(`setText(${key}) ✓`)
    }
  }

  // ---------------------------------------------------------------- 6
  step(6, 'Verifying through the Universal Resolver')
  const readBack = await getContenthash(publicClient, COLLECTION)
  const ok = readBack.toLowerCase() === contenthash.toLowerCase()
  info(`resolves to: ${readBack} ${ok ? '✓' : '✗ MISMATCH'}`)
  if (!ok) throw new Error('the name does not resolve to what was just written')

  const decoded = storage.fromContenthash(readBack)
  info(`decodes to:  ${decoded.ref} ${decoded.ref === ref.ref ? '✓' : '✗'}`)

  console.log(`\nPublished ${COLLECTION}\n`)
  console.log(
    JSON.stringify(
      {
        collection: COLLECTION,
        resolver,
        contenthash,
        ref: ref.ref,
        entries: collection.entries.length,
        contentKey: `0x${Buffer.from(contentKey).toString('hex')}`,
      },
      null,
      2,
    ),
  )
  console.log(
    '\nKeep the contentKey: it is required to publish updates and to wrap keys for ' +
      'subscribers, and it is not written to chain.\n',
  )
}

main().catch((e) => {
  console.error('\npublish-collection failed:', e)
  process.exit(1)
})
