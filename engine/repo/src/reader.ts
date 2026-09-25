/**
 * Read a namespace from the network alone.
 *
 * This is what an independent agent runs. It takes a network and a private key
 * and nothing else — no repository, no database, no API belonging to whoever
 * wrote the namespace. If the company that wrote it is deleted, every input
 * this function needs is still where it was.
 *
 *   records.contenthash  →  refs  →  head commit  →  claims
 *   records.text(knowledge.access)  →  manifest  →  sealed key  →  content key
 *
 * Every commit is validated against its own id on the way in, so a storage
 * node that returns different bytes is caught rather than believed.
 */
import {
  decodeObject, publicKeyFromPrivate, unwrapKey, validateCommit,
  type Commit, type Knowledge, type Refs,
} from '@recall/core'
import type { Identity } from '@recall/storage'
import type { Hex } from 'viem'
import { grantId, readManifest, type AccessGrant, type AccessManifest } from './access.js'
import type { Network } from './network.js'

/** The namespace exists but this key holds no grant for it. */
export class AccessDenied extends Error {
  constructor(readonly namespace: string, readonly reason: 'no-grant' | 'stale-key') {
    super(reason === 'no-grant'
      ? `${namespace} is private and this agent has not been granted access`
      : `${namespace} was re-keyed and this agent's access was not renewed`)
    this.name = 'AccessDenied'
  }
}

/** Nothing has been published under this name. */
export class NotPublished extends Error {
  constructor(readonly namespace: string) {
    super(`${namespace} has no published version`)
    this.name = 'NotPublished'
  }
}

export type Reader = { privateKey: Hex }

export type ResolvedNamespace = {
  namespace: string
  /** How the namespace is readable: plaintext to everyone, or sealed. */
  readers: 'public' | 'key'
  /** The grant this reader used, when the namespace is sealed. */
  grant?: AccessGrant
  version: number
  head: string
  publishedAt: string
  title?: string
  description?: string
  claims: Knowledge[]
  /** First-parent history, newest first. */
  history: Array<Pick<Commit, 'id' | 'author' | 'timestamp' | 'message' | 'changes' | 'proposal'>>
  /** The storage ref (CID) of the refs object — what `contenthash` points at. */
  refsCid: string
  contenthash: Hex
}

/** This reader's grant in a manifest, if it has one. */
export function grantFor(manifest: AccessManifest | null, reader: Reader): AccessGrant | null {
  if (!manifest) return null
  const id = grantId(publicKeyFromPrivate(reader.privateKey))
  return manifest.grants.find((g) => g.id === id) ?? null
}

async function identityFor(network: Network, namespace: string, reader: Reader | null): Promise<{ as: Identity; manifest: AccessManifest | null; grant?: AccessGrant }> {
  const manifest = await readManifest(network, namespace)
  if (!manifest || manifest.readers === 'public') return { as: { plaintext: true }, manifest }
  if (!reader) throw new AccessDenied(namespace, 'no-grant')
  const grant = grantFor(manifest, reader)
  if (!grant?.wrappedKey) throw new AccessDenied(namespace, 'no-grant')
  return { as: { contentKey: unwrapKey(grant.wrappedKey, reader.privateKey) }, manifest, grant }
}

/**
 * Resolve a namespace to its current claims and history.
 *
 * A namespace with no manifest is treated as public: that is how namespaces
 * published before grants existed read, and a private one without a manifest
 * has no sealed key anyone could use anyway — its refs will not decode, and
 * that is reported as denied rather than as corruption.
 */
export async function resolveNamespace(network: Network, namespace: string, reader: Reader | null): Promise<ResolvedNamespace> {
  const records = network.records(namespace)
  const contenthash = await records.read()
  if (!contenthash) throw new NotPublished(namespace)

  const { as, manifest, grant } = await identityFor(network, namespace, reader)
  const refsRef = network.storage.fromContenthash(contenthash)

  let refs: Refs
  try {
    refs = decodeObject<Refs>(await network.storage.get(refsRef, as))
  } catch {
    // The only way a well-formed pointer fails to decrypt is a key that no
    // longer opens it: a grant made before the last re-key, or no grant at all.
    throw new AccessDenied(namespace, grant ? 'stale-key' : 'no-grant')
  }
  if (refs.kind !== 'refs' || refs.namespace !== namespace) throw new Error(`${namespace} points at something that is not its refs`)

  const commits = new Map<string, Commit>()
  const fetch = async (id: string): Promise<Commit> => {
    const hit = commits.get(id)
    if (hit) return hit
    const ref = refs.objects[id]
    if (!ref) throw new Error(`${namespace} references commit ${id} but does not publish it`)
    const c = decodeObject<Commit>(await network.storage.get({ kind: network.storage.kind, ref }, as))
    validateCommit(c)
    if (c.id !== id) throw new Error(`object ${ref} claims to be ${id} but is ${c.id}`)
    commits.set(id, c)
    return c
  }

  const headId = refs.branches[refs.head]
  if (!headId) throw new NotPublished(namespace)
  const head = await fetch(headId)

  const history: ResolvedNamespace['history'] = []
  for (let c: Commit | undefined = head; c; c = c.parents[0] ? await fetch(c.parents[0]) : undefined) {
    history.push({ id: c.id, author: c.author, timestamp: c.timestamp, message: c.message, changes: c.changes, ...(c.proposal ? { proposal: c.proposal } : {}) })
  }

  return {
    namespace,
    readers: manifest?.readers ?? (as.plaintext ? 'public' : 'key'),
    ...(grant ? { grant } : {}),
    version: history.length,
    head: head.id,
    publishedAt: refs.updatedAt,
    ...(refs.title ? { title: refs.title } : {}),
    ...(refs.description ? { description: refs.description } : {}),
    claims: Object.values(head.snapshot),
    history,
    refsCid: refsRef.ref,
    contenthash,
  }
}

/** Whether this reader may read a namespace, without fetching it. */
export async function canRead(network: Network, namespace: string, reader: Reader | null): Promise<boolean> {
  try { await identityFor(network, namespace, reader); return true } catch { return false }
}
