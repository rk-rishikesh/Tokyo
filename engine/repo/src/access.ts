/**
 * Who may read a namespace, published where anyone can check.
 *
 * A private namespace is encrypted with one content key. Granting an agent read
 * access means sealing that key to the agent's public key and publishing the
 * sealed copy in an access manifest the namespace points at — so the grant is a
 * fact on the network rather than a row in the app that made it.
 *
 * Two consequences follow, and they are the reason it is built this way.
 *
 *   - **A denied namespace cannot be read.** Not "the interface hides it": the
 *     agent never receives a key, so the bytes it can fetch are ciphertext.
 *     Scoping is per namespace because keys are per namespace — granting
 *     `food.you.eth` says nothing about `work.you.eth`.
 *
 *   - **Revoking re-keys.** Dropping a sealed key from the manifest is not
 *     enough: the revoked agent still has the old key, and the old key still
 *     opens every object encrypted with it. So a revoke generates a new key,
 *     re-encrypts every version, and re-seals it for whoever remains. What the
 *     agent already read, it may have kept; that is true of any system, and the
 *     interface says so rather than promising otherwise.
 *
 * The manifest itself is plaintext. It holds only public keys and sealed keys,
 * and a sealed key is useless to anyone but the holder of the matching private
 * key — which is what makes it safe to publish.
 *
 * It can also hold **offers**: what access costs and where to buy it. An agent
 * that resolves the name finds the price next to the grants, pays the endpoint
 * over x402, and receives a grant sealed to its own key, with the payment on
 * it as a receipt. Paid grants last until the end of the offer's epoch; at the
 * epoch boundary the owner re-keys once (`rotateEpoch`) and whoever still
 * wants access pays again. Revoking one reader at a time would mean re-keying
 * on every expiry.
 */
import { decodeObject, encodeObject, generateContentKey, wrapKey } from '@knowledge01/core'
import { keccak256, type Hex } from 'viem'
import { ACCESS_RECORD, type Network } from './network.js'
import { Remote } from './remote.js'
import type { Repository } from './repository.js'

export type AccessRole = 'read' | 'propose'

export type AccessGrant = {
  /** Short, stable id derived from the public key. */
  id: string
  /** What the agent calls itself. A label, not an identity — the key is the identity. */
  agent: string
  /** SEC1 public key the content key is sealed to. */
  pubkey: Hex
  role: AccessRole
  /** The namespace's content key, sealed to `pubkey`. Absent for public namespaces. */
  wrappedKey?: Hex
  /** The owner's own recovery grant, derived from their wallet. */
  owner?: boolean
  grantedAt: string
  /** When a paid grant stops being renewed: the end of its offer's epoch. */
  validUntil?: string
  /** What was paid for it, when it was bought. */
  payment?: AccessPayment
}

/** A price for access, published in the manifest so any agent can find it. */
export type AccessOffer = {
  role: AccessRole
  /** In dollars, as x402 prices are written: "$0.01". */
  price: string
  /** CAIP-2 network the payment settles on, e.g. eip155:84532 (Base Sepolia). */
  network: string
  asset: string
  payTo: Hex
  /** The x402 endpoint that sells the grant. */
  endpoint: string
  /** Paid grants last until the end of the current epoch of this many days. */
  epochDays: number
  description?: string
}

/** The receipt a paid grant carries. */
export type AccessPayment = { scheme: 'x402'; network: string; asset: string; amount: string; payer: string; tx?: string }

export type AccessManifest = {
  kind: 'access'
  namespace: string
  /** `public` namespaces are plaintext and need no key; `key` ones are sealed. */
  readers: 'public' | 'key'
  /** Increments on every re-key, so a reader can tell its key is stale. */
  keyVersion: number
  grants: AccessGrant[]
  offers?: AccessOffer[]
  updatedAt: string
}

export const grantId = (pubkey: Hex): string => keccak256(pubkey.toLowerCase() as Hex).slice(2, 18)

/** The published manifest for a namespace, or null if nobody has granted anything yet. */
export async function readManifest(network: Network, namespace: string): Promise<AccessManifest | null> {
  const ref = await network.records(namespace).readText(ACCESS_RECORD)
  if (!ref) return null
  const bytes = await network.storage.get({ kind: network.storage.kind, ref }, { plaintext: true })
  const m = decodeObject<AccessManifest>(bytes)
  if (m.kind !== 'access' || m.namespace !== namespace) throw new Error(`${namespace} points at something that is not its access manifest`)
  return m
}

async function writeManifest(network: Network, m: AccessManifest): Promise<{ ref: string; receipt: string }> {
  const ref = await network.storage.put(encodeObject(m), { collection: m.namespace, plaintext: true })
  const receipt = await network.records(m.namespace).writeText(ACCESS_RECORD, ref.ref)
  return { ref: ref.ref, receipt }
}

function contentKeyOf(repo: Repository): Uint8Array | null {
  const hex = repo.store.readConfig().contentKey
  return hex ? Uint8Array.from(Buffer.from(hex.replace(/^0x/, ''), 'hex')) : null
}

export type GrantInput = { agent: string; pubkey: Hex; role?: AccessRole; owner?: boolean; validUntil?: string; payment?: AccessPayment }

/**
 * Give an agent access to a namespace.
 *
 * Publishes first. A grant to a namespace that is not on the network would be a
 * sealed key to nothing, and the agent would find an empty name.
 */
export async function grantAccess(repo: Repository, network: Network, input: GrantInput): Promise<AccessManifest> {
  await new Remote(repo, network.storage, network.records(repo.namespace)).push()
  const readers = repo.policy.readers === 'public' ? 'public' : 'key'
  const key = contentKeyOf(repo)
  if (readers === 'key' && !key) throw new Error(`${repo.namespace} is private but this machine has no content key for it`)
  return (await sealGrant(network, repo.namespace, { readers, contentKey: key }, input)).manifest
}

/**
 * Seal a grant into a published namespace's manifest, without a local
 * repository: what a server that sells access runs. It needs the content key
 * and a wallet that may write the name's records — nothing else.
 */
export async function sealGrant(
  network: Network, namespace: string,
  access: { readers: 'public' | 'key'; contentKey: Uint8Array | null },
  input: GrantInput,
): Promise<{ manifest: AccessManifest; grant: AccessGrant; receipt: string }> {
  if (access.readers === 'key' && !access.contentKey) throw new Error(`${namespace} is private and no content key was given`)
  const current = await readManifest(network, namespace)
  const grant: AccessGrant = {
    id: grantId(input.pubkey),
    agent: input.agent,
    pubkey: input.pubkey,
    role: input.role ?? 'read',
    ...(access.readers === 'key' ? { wrappedKey: wrapKey(access.contentKey!, input.pubkey) } : {}),
    ...(input.owner ? { owner: true } : {}),
    grantedAt: new Date().toISOString(),
    ...(input.validUntil ? { validUntil: input.validUntil } : {}),
    ...(input.payment ? { payment: input.payment } : {}),
  }
  const manifest: AccessManifest = {
    kind: 'access',
    namespace,
    readers: current?.readers ?? access.readers,
    keyVersion: current?.keyVersion ?? 1,
    grants: [...(current?.grants ?? []).filter((g) => g.id !== grant.id), grant],
    ...(current?.offers ? { offers: current.offers } : {}),
    updatedAt: grant.grantedAt,
  }
  const { receipt } = await writeManifest(network, manifest)
  return { manifest, grant, receipt }
}

/** Publish what access costs. Replaces the namespace's offers; grants are untouched. */
export async function setOffers(repo: Repository, network: Network, offers: AccessOffer[]): Promise<AccessManifest> {
  await new Remote(repo, network.storage, network.records(repo.namespace)).push()
  const current = await readManifest(network, repo.namespace)
  const m: AccessManifest = {
    kind: 'access',
    namespace: repo.namespace,
    readers: current?.readers ?? (repo.policy.readers === 'public' ? 'public' : 'key'),
    keyVersion: current?.keyVersion ?? 1,
    grants: current?.grants ?? [],
    offers,
    updatedAt: new Date().toISOString(),
  }
  await writeManifest(network, m)
  return m
}

/** The end of the epoch `now` falls in: epochs are counted from the Unix epoch, so every seller agrees on them. */
export function epochEnd(epochDays: number, now = Date.now()): string {
  const len = epochDays * 86_400_000
  return new Date((Math.floor(now / len) + 1) * len).toISOString()
}

/**
 * Take an agent's access away, and make it mean something.
 *
 * Generates a new content key, re-encrypts every version under it, and seals
 * the new key only for the grants that remain. An agent holding the old key can
 * still open what it already downloaded — no system can recall a copy — but not
 * anything published after this.
 */
export async function revokeAccess(repo: Repository, network: Network, pubkeyOrId: string): Promise<AccessManifest> {
  const target = pubkeyOrId.startsWith('0x') ? grantId(pubkeyOrId as Hex) : pubkeyOrId
  const m = await revokeWhere(repo, network, (g) => g.id === target)
  if (!m) throw new Error(`no grant ${target} on ${repo.namespace}`)
  return m
}

/**
 * End an epoch: drop every paid grant whose epoch is over, with one re-key for
 * all of them. Grants without an end — the owner's, and ones given freely —
 * are re-sealed and carry on. Returns null when nothing had expired.
 */
export const rotateEpoch = (repo: Repository, network: Network, now = Date.now()): Promise<AccessManifest | null> =>
  revokeWhere(repo, network, (g) => !!g.validUntil && Date.parse(g.validUntil) <= now)

async function revokeWhere(repo: Repository, network: Network, drop: (g: AccessGrant) => boolean): Promise<AccessManifest | null> {
  const current = await readManifest(network, repo.namespace)
  if (!current) throw new Error(`${repo.namespace} has no access manifest to revoke from`)
  const remaining = current.grants.filter((g) => !drop(g))
  if (remaining.length === current.grants.length) return null

  let grants = remaining
  let keyVersion = current.keyVersion
  if (current.readers === 'key') {
    // Re-key: a fresh key, every version re-encrypted under it, refs rewritten.
    const next = generateContentKey()
    const cfg = repo.store.readConfig()
    repo.store.writeConfig({ ...cfg, contentKey: Buffer.from(next).toString('hex') })
    const refs = repo.store.readRefs()
    refs.objects = {}
    repo.store.writeRefs(refs)
    await new Remote(repo, network.storage, network.records(repo.namespace)).push()
    keyVersion++
    grants = remaining.map((g) => ({ ...g, wrappedKey: wrapKey(next, g.pubkey) }))
  }

  const m: AccessManifest = { ...current, keyVersion, grants, updatedAt: new Date().toISOString() }
  await writeManifest(network, m)
  return m
}

export { OWNER_KEY_MESSAGE, ownerKeyFromSignature } from './owner-key.js'
