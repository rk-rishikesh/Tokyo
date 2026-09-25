/**
 * Pinata adapter — the default storage path (PRD §7).
 *
 * IPFS has no access control, so confidentiality is the application's job:
 * content is AES-256-GCM encrypted before pinning, and the content key is
 * ECIES-wrapped to each subscriber's public key.
 *
 * `nativeAccessControl: false`, `versionedRevocation: false`.
 */
import {
  decryptBytes,
  encryptBytes,
  generateContentKey,
  rekey,
  unwrapKey,
  wrapKey,
} from '@recall/core'
import type { Hex } from 'viem'
import {
  CODECS,
  decodeContenthash,
  encodeContenthash,
  normaliseRef,
} from './contenthash.js'
import {
  StorageError,
  type GrantResult,
  type Identity,
  type CollectionCtx,
  type StorageAdapter,
  type StorageRef,
} from './types.js'

export type PinataConfig = {
  /**
   * Pinning credential. Only needed to *write*.
   *
   * Reading goes through the gateway over plain HTTP, so a subscriber needs no
   * Pinata account at all — requiring one would mean every reader of every collection
   * had to sign up with the publisher's storage provider, which is the opposite
   * of what content addressing is for.
   */
  jwt?: string
  /** Dedicated gateway host, e.g. "my-gateway.mypinata.cloud". */
  gateway: string
  /** Override for tests. */
  apiBase?: string
}

const PINATA_API = 'https://api.pinata.cloud'

export class PinataAdapter implements StorageAdapter {
  readonly kind = 'ipfs' as const
  readonly codec = CODECS.ipfs
  readonly capabilities = {
    nativeAccessControl: false,
    versionedRevocation: false,
  }

  constructor(private readonly config: PinataConfig) {
    // Deliberately not checking the JWT here: reads are valid without it.
    if (!config.gateway) {
      throw new StorageError('PINATA_GATEWAY is required — reads are fetched through it')
    }
  }

  private get apiBase(): string {
    return this.config.apiBase ?? PINATA_API
  }

  /** Encrypt with the collection content key, then pin the ciphertext. */
  async put(bytes: Uint8Array, ctx: CollectionCtx): Promise<StorageRef> {
    if (ctx.plaintext) {
      const cid = await this.pin(bytes, ctx.collection)
      return { kind: 'ipfs', ref: normaliseRef(CODECS.ipfs, cid) }
    }
    if (!ctx.contentKey) {
      throw new StorageError(
        'PinataAdapter.put requires ctx.contentKey — IPFS has no native access control, ' +
          'so unencrypted content would be world-readable at the CID',
      )
    }
    const ciphertext = encryptBytes(bytes, ctx.contentKey)
    const cid = await this.pin(ciphertext, ctx.collection)
    return { kind: 'ipfs', ref: normaliseRef(CODECS.ipfs, cid) }
  }

  /** Fetch the ciphertext and decrypt it for this reader. */
  async get(ref: StorageRef, as: Identity): Promise<Uint8Array> {
    if (ref.kind !== 'ipfs') {
      throw new StorageError(`PinataAdapter cannot read a "${ref.kind}" ref`)
    }
    if (as.plaintext) return this.fetch(ref.ref)
    const contentKey = this.resolveContentKey(as)
    const ciphertext = await this.fetch(ref.ref)
    try {
      return decryptBytes(ciphertext, contentKey)
    } catch (e) {
      // GCM tag mismatch. The usual cause is a lapsed subscription: the collection
      // was re-keyed and this reader's wrapped key is for the previous key.
      throw new StorageError(
        'Could not decrypt collection content. The content key does not match — ' +
          'the collection has most likely been re-keyed since this key was issued.',
        e,
      )
    }
  }

  /**
   * Wrap the existing content key to each new public key.
   *
   * The stored bytes do not change, so the ref does not change. The caller
   * writes each returned `wrappedKey` to that subscriber's
   * `data: wrappedKey` record.
   */
  async grant(ref: StorageRef, pubkeys: Hex[], ctx: CollectionCtx): Promise<GrantResult> {
    if (!ctx.contentKey) {
      throw new StorageError('grant requires ctx.contentKey to wrap')
    }
    return {
      ref,
      wrapped: pubkeys.map((pubkey) => ({
        pubkey,
        wrappedKey: wrapKey(ctx.contentKey!, pubkey),
      })),
    }
  }

  /**
   * Revoke by re-keying. Always.
   *
   * `pubkeys` here is the set to remove; `ctx` must carry the current content
   * key so the plaintext can be recovered and re-encrypted under a new one.
   * `remaining` is supplied by the caller because only the caller knows which
   * subscriptions are still live on chain.
   */
  async revoke(
    ref: StorageRef,
    pubkeys: Hex[],
    ctx: CollectionCtx & { remaining?: Hex[] },
  ): Promise<GrantResult> {
    if (!ctx.contentKey) {
      throw new StorageError('revoke requires ctx.contentKey to decrypt current content')
    }
    const removed = new Set(pubkeys.map((p) => p.toLowerCase()))
    const remaining = (ctx.remaining ?? []).filter((p) => !removed.has(p.toLowerCase()))

    const plaintext = await this.get(ref, { contentKey: ctx.contentKey })
    const next = rekey(plaintext, remaining)
    const cid = await this.pin(next.ciphertext, ctx.collection)

    return {
      ref: { kind: 'ipfs', ref: normaliseRef(CODECS.ipfs, cid) },
      wrapped: next.wrapped,
      contentKey: next.contentKey,
    }
  }

  toContenthash(ref: StorageRef): Hex {
    if (ref.kind !== 'ipfs') {
      throw new StorageError(`PinataAdapter cannot encode a "${ref.kind}" ref`)
    }
    return encodeContenthash(CODECS.ipfs, ref.ref)
  }

  fromContenthash(hash: Hex): StorageRef {
    const { codec, ref } = decodeContenthash(hash)
    if (codec !== CODECS.ipfs) {
      throw new StorageError(`expected an ipfs contenthash, got "${codec}"`)
    }
    return { kind: 'ipfs', ref }
  }

  // -------------------------------------------------------------------------

  private resolveContentKey(as: Identity): Uint8Array {
    if (as.contentKey) return as.contentKey
    if (as.wrappedKey && as.privateKey) return unwrapKey(as.wrappedKey, as.privateKey)
    throw new StorageError(
      'Identity must carry either a contentKey or a wrappedKey plus privateKey',
    )
  }

  /** Pin raw bytes and return the CID. */
  private async pin(bytes: Uint8Array, collectionName: string): Promise<string> {
    const form = new FormData()
    form.append(
      'file',
      new Blob([bytes as BlobPart], { type: 'application/octet-stream' }),
      `${collectionName}.recall`,
    )
    form.append(
      'pinataMetadata',
      JSON.stringify({ name: `recall:${collectionName}`, keyvalues: { collection: collectionName } }),
    )
    form.append('pinataOptions', JSON.stringify({ cidVersion: 1 }))

    if (!this.config.jwt) {
      throw new StorageError(
        'PINATA_JWT is required to publish. Reading a collection does not need one; only the ' +
          'publisher pins content.',
      )
    }
    const res = await fetch(`${this.apiBase}/pinning/pinFileToIPFS`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.config.jwt}` },
      body: form,
    })
    if (!res.ok) {
      const body = await res.text()
      throw new StorageError(
        body.includes('NO_SCOPES_FOUND')
          ? 'Pinata rejected the key: it authenticates but has no scopes. Create a key with ' +
              'pinFileToIPFS (or Admin) permission.'
          : `Pinata pin failed: ${res.status} ${body}`,
      )
    }
    const body = (await res.json()) as { IpfsHash?: string }
    if (!body.IpfsHash) throw new StorageError('Pinata response had no IpfsHash')
    return body.IpfsHash
  }

  /**
   * Fetch by CID through the configured dedicated gateway.
   *
   * Never a public gateway — latency on stage is a listed risk (PRD §14) and a
   * public gateway also leaks which collection is being read to a third party.
   */
  private async fetch(cid: string): Promise<Uint8Array> {
    const host = this.config.gateway.replace(/^https?:\/\//, '').replace(/\/$/, '')
    const res = await fetch(`https://${host}/ipfs/${cid}`)
    if (!res.ok) {
      throw new StorageError(`Gateway fetch failed for ${cid}: ${res.status}`)
    }
    return new Uint8Array(await res.arrayBuffer())
  }
}

/** Mint a content key for a new collection. */
export { generateContentKey }
