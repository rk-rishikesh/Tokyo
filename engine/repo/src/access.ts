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
 */
import { decodeObject, encodeObject, generateContentKey, wrapKey } from '@k01/core'
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
}

export type AccessManifest = {
  kind: 'access'
  namespace: string
  /** `public` namespaces are plaintext and need no key; `key` ones are sealed. */
  readers: 'public' | 'key'
  /** Increments on every re-key, so a reader can tell its key is stale. */
  keyVersion: number
  grants: AccessGrant[]
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

export type GrantInput = { agent: string; pubkey: Hex; role?: AccessRole; owner?: boolean }

/**
 * Give an agent access to a namespace.
 *
 * Publishes first. A grant to a namespace that is not on the network would be a
 * sealed key to nothing, and the agent would find an empty name.
 */
export async function grantAccess(repo: Repository, network: Network, input: GrantInput): Promise<AccessManifest> {
  await new Remote(repo, network.storage, network.records(repo.namespace)).push()

  const readers = repo.policy.readers === 'public' ? 'public' : 'key'
  const current = await readManifest(network, repo.namespace)
  const key = contentKeyOf(repo)
  if (readers === 'key' && !key) throw new Error(`${repo.namespace} is private but this machine has no content key for it`)

  const grant: AccessGrant = {
    id: grantId(input.pubkey),
    agent: input.agent,
    pubkey: input.pubkey,
    role: input.role ?? 'read',
    ...(readers === 'key' ? { wrappedKey: wrapKey(key!, input.pubkey) } : {}),
    ...(input.owner ? { owner: true } : {}),
    grantedAt: new Date().toISOString(),
  }

  const m: AccessManifest = {
    kind: 'access',
    namespace: repo.namespace,
    readers,
    keyVersion: current?.keyVersion ?? 1,
    grants: [...(current?.grants ?? []).filter((g) => g.id !== grant.id), grant],
    updatedAt: grant.grantedAt,
  }
  await writeManifest(network, m)
  return m
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
  const current = await readManifest(network, repo.namespace)
  if (!current) throw new Error(`${repo.namespace} has no access manifest to revoke from`)
  const target = pubkeyOrId.startsWith('0x') ? grantId(pubkeyOrId as Hex) : pubkeyOrId
  const remaining = current.grants.filter((g) => g.id !== target)
  if (remaining.length === current.grants.length) throw new Error(`no grant ${target} on ${repo.namespace}`)

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
