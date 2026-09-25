/**
 * Resolve → fetch → decrypt → index.
 *
 * The read path an agent's question travels. Access control is *not* enforced
 * here by policy: a lapsed subscriber fails at the decrypt step because their
 * wrapped key is for a content key that has been rotated away. There is nothing
 * to "check" and nothing to revoke.
 */
import {
  CollectionIndex,
  getContenthash,
  getData,
  getText,
  findExpiry,
  parseCollection,
  parseRevoked,
  type Collection,
} from '@knowledge01/core'
import { createStorage, type StorageAdapter, type StorageRef } from '@knowledge01/storage'
import { hexToBytes, type Hex, type PublicClient } from 'viem'
import type { Identity } from '@knowledge01/storage'
import type { Cache } from './cache.js'

/** Record keys on the collection name, per PRD §5.2. */
export const RECORDS = {
  schema: 'recall.schema',
  price: 'recall.price',
  storage: 'recall.storage',
  title: 'recall.title',
  description: 'recall.description',
  upstream: 'recall.upstream',
  upstreamRef: 'recall.upstreamRef',
  revoked: 'recall.revoked',
  actHistory: 'recall.actHistory',
  actPublisher: 'recall.actPublisher',
} as const

/** Data keys on subscription and proposal names. */
export const DATA_KEYS = {
  wrappedKey: 'wrappedKey',
  candidateRef: 'candidateRef',
  parentRef: 'parentRef',
} as const

export type CollectionConfig = {
  name: string
  title: string
  description: string
  /** Upstream collection this one forked from, if any. */
  upstream: string | null
  /** Entry ids the publisher has revoked. */
  revoked: string[]
  contenthash: Hex | null
  storage: 'pinata' | 'swarm'
  schema: string
  /** `<amount>:<termSeconds>`, as written to `text: recall.price`. */
  price: string
  actHistory?: string
  actPublisher?: string
}

/** Read a collection's on-chain configuration. */
export async function readCollectionConfig(
  client: PublicClient,
  name: string,
): Promise<CollectionConfig> {
  const [
    contenthash,
    storage,
    schema,
    price,
    title,
    description,
    upstream,
    revokedRecord,
    actHistory,
    actPublisher,
  ] =
    await Promise.all([
      getContenthash(client, name),
      getText(client, name, RECORDS.storage),
      getText(client, name, RECORDS.schema),
      getText(client, name, RECORDS.price),
      getText(client, name, RECORDS.title).catch(() => ''),
      getText(client, name, RECORDS.description).catch(() => ''),
      getText(client, name, RECORDS.upstream).catch(() => ''),
      getText(client, name, RECORDS.revoked).catch(() => ''),
      getText(client, name, RECORDS.actHistory),
      getText(client, name, RECORDS.actPublisher),
    ])
  return {
    name,
    title,
    description,
    upstream: upstream || null,
    revoked: parseRevoked(revokedRecord),
    contenthash: contenthash === '0x' ? null : contenthash,
    storage: storage === 'swarm' ? 'swarm' : 'pinata',
    schema,
    price,
    ...(actHistory ? { actHistory } : {}),
    ...(actPublisher ? { actPublisher } : {}),
  }
}

/** The subscription name for an address under a collection. */
export const subscriptionName = (collection: string, address: string): string =>
  `sub-${address.toLowerCase()}.${collection}`

/** The proposal name for a proposal number under a collection. */
export const proposalName = (collection: string, n: number): string => `pr-${n}.${collection}`

export type Subscription = {
  collection: string
  name: string
  expiry: bigint
  active: boolean
  wrappedKey: Hex | null
}

/**
 * Read a subscription's live state.
 *
 * Expiry comes from the collection's own subregistry, so "subscribed" means exactly
 * "holds a live name" — there is no second list to disagree with the chain.
 */
export async function readSubscription(
  client: PublicClient,
  registry: `0x${string}`,
  collection: string,
  address: string,
): Promise<Subscription> {
  const name = subscriptionName(collection, address)
  const label = `sub-${address.toLowerCase()}`
  const [expiry, wrappedKey] = await Promise.all([
    findExpiry(client, registry, label).catch(() => 0n),
    getData(client, name, DATA_KEYS.wrappedKey).catch(() => '0x' as Hex),
  ])
  return {
    collection,
    name,
    expiry,
    active: expiry > BigInt(Math.floor(Date.now() / 1000)),
    wrappedKey: wrappedKey === '0x' ? null : wrappedKey,
  }
}

/** Build the `StorageRef` a collection's contenthash points at. */
export function refFor(adapter: StorageAdapter, config: CollectionConfig): StorageRef {
  if (!config.contenthash) {
    throw new Error(`${config.name} has no contenthash set`)
  }
  const ref = adapter.fromContenthash(config.contenthash)
  // A swarm contenthash cannot carry the ACT history or publisher key, so they
  // are stitched back in from the collection's text records.
  if (ref.kind === 'swarm') {
    if (!config.actHistory || !config.actPublisher) {
      throw new Error(
        `${config.name} uses swarm storage but is missing text: recall.actHistory ` +
          `or text: recall.actPublisher — an ACT read cannot be attempted without them`,
      )
    }
    return { ...ref, actHistory: config.actHistory, actPublisher: config.actPublisher }
  }
  return ref
}

export type LoadOptions = {
  /** The reader's private key, for unwrapping their content key. */
  privateKey?: Hex
  /** The address whose subscription holds the wrapped key. */
  subscriber?: string
  /**
   * The collection content key, held directly.
   *
   * This is the publisher's path — they minted the key and never had it wrapped
   * to themselves. A subscriber leaves this unset and gets the key from their
   * own subscription's `wrappedKey` record instead.
   */
  contentKey?: Uint8Array
  /** Force a fetch even if the cache looks valid. */
  force?: boolean
}

/**
 * Work out how this reader can open the collection.
 *
 * Two legitimate paths, tried in order:
 *
 *   1. **Holding the key directly** — the publisher, or an operator given it.
 *   2. **Unwrapping it from a subscription** — the normal subscriber path. The
 *      key is sealed to their public key and written to `data: wrappedKey` on
 *      their own subscription name, so fetching it is itself a proof that the
 *      name exists. If the subscription has lapsed and the collection has been
 *      re-keyed since, the wrapped key is stale and decryption fails — which is
 *      exactly how access ends, with no revocation transaction anywhere.
 */
async function resolveIdentity(
  client: PublicClient,
  collection: string,
  opts: LoadOptions,
  cachedKey: Hex | null,
): Promise<Identity> {
  if (opts.contentKey) return { contentKey: opts.contentKey }
  if (cachedKey) return { contentKey: hexToBytes(cachedKey) }

  if (opts.privateKey && opts.subscriber) {
    const name = subscriptionName(collection, opts.subscriber)
    const wrapped = await getData(client, name, DATA_KEYS.wrappedKey).catch(() => '0x' as Hex)
    if (wrapped !== '0x') {
      return { wrappedKey: wrapped, privateKey: opts.privateKey }
    }
    throw new Error(
      `No wrapped key found at ${name}. Either the subscription does not exist, or the ` +
        'publisher has not yet sealed the content key to it.',
    )
  }

  throw new Error(
    'No way to open this collection. Set RECALL_CONTENT_KEY if you hold the key directly, or ' +
      'RECALL_SUBSCRIBER_ADDRESS and RECALL_SUBSCRIBER_KEY to unwrap it from a subscription.',
  )
}

export type LoadedCollection = {
  collection: Collection
  ref: string
  contenthash: Hex | null
  fromCache: boolean
  /** Set when the subscriber pinned a ref and it differs from head. */
  pinnedBehindHead?: boolean
}

/**
 * Load a collection's decrypted content, using the cache when it is still valid.
 *
 * Honours pin state: a pinned subscriber keeps reading the ref they pinned even
 * after the maintainer moves the pointer. That is what makes "a pinned
 * subscriber never receives it" true in the demo's step 6.
 */
export async function loadCollection(
  client: PublicClient,
  cache: Cache,
  name: string,
  opts: LoadOptions = {},
): Promise<LoadedCollection> {
  const config = await readCollectionConfig(client, name)
  const cached = cache.get(name)
  const pin = cached?.pin ?? { kind: 'head' as const }

  // A pinned subscriber reads their pinned ref, whatever the chain now says.
  const targetRef = pin.kind === 'pinned' ? pin.ref : null

  if (!opts.force && pin.kind === 'head') {
    const valid = cache.valid(name, config.contenthash)
    if (valid?.collection && valid.ref) {
      return {
        collection: valid.collection,
        ref: valid.ref,
        contenthash: config.contenthash,
        fromCache: true,
      }
    }
  }
  if (!opts.force && pin.kind === 'pinned' && cached?.collection && cached.ref === pin.ref) {
    return {
      collection: cached.collection,
      ref: cached.ref,
      contenthash: config.contenthash,
      fromCache: true,
      pinnedBehindHead: true,
    }
  }

  const adapter = createStorage(config.storage)
  const headRef = refFor(adapter, config)
  const ref: StorageRef = targetRef ? { ...headRef, ref: targetRef } : headRef

  const identity = await resolveIdentity(client, name, opts, cached?.contentKey ?? null)
  const bytes = await adapter.get(ref, identity)
  const collection = parseCollection(bytes)

  cache.update(name, {
    collection,
    ref: ref.ref,
    contenthash: config.contenthash,
    // Remember the key so later reads skip the unwrap. It lives in a 0600 file
    // the agent never sees — key custody stays with the server.
    ...(identity.contentKey
      ? { contentKey: (`0x${Buffer.from(identity.contentKey).toString('hex')}`) as Hex }
      : {}),
  })

  return {
    collection,
    ref: ref.ref,
    contenthash: config.contenthash,
    fromCache: false,
    ...(targetRef && targetRef !== headRef.ref ? { pinnedBehindHead: true } : {}),
  }
}

/** Build a fresh search index over the given collections. */
export function buildIndex(collections: Collection[]): CollectionIndex {
  const index = new CollectionIndex()
  for (const collection of collections) index.addCollection(collection)
  return index
}
