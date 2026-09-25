/**
 * In-memory adapter with the same confidentiality semantics as Pinata.
 *
 * Not a stub: it encrypts, it re-keys on revoke, and it produces real
 * contenthashes. It exists so the collection lifecycle can be tested and demoed
 * without a Pinata account or network, and so the security-relevant behaviour
 * (re-key on revoke) is covered by tests that run in CI.
 *
 * Refs are the CIDv1 of the stored bytes, so they are stable and content-addressed
 * exactly like the real thing.
 */
import { decryptBytes, encryptBytes, rekey, unwrapKey, wrapKey } from '@knowledge01/core'
import { sha256 } from '@noble/hashes/sha2'
import { base32 } from '@scure/base'
import type { Hex } from 'viem'
import { CODECS, decodeContenthash, encodeContenthash } from './contenthash.js'
import {
  StorageError,
  type GrantResult,
  type Identity,
  type CollectionCtx,
  type StorageAdapter,
  type StorageRef,
} from './types.js'

/** CIDv1 / dag-pb / sha2-256 for a byte string. */
function cidV1(bytes: Uint8Array): string {
  const digest = sha256(bytes)
  const out = new Uint8Array(digest.length + 4)
  out.set([0x01, 0x70, 0x12, 0x20]) // version 1, dag-pb, sha2-256, 32 bytes
  out.set(digest, 4)
  return 'b' + base32.encode(out).toLowerCase().replace(/=+$/, '')
}

/** Where the bytes live. A Map in memory; a directory for the file-backed adapter. */
export interface ByteStore {
  get(ref: string): Uint8Array | undefined
  set(ref: string, bytes: Uint8Array): void
}

export class MemoryAdapter implements StorageAdapter {
  readonly kind = 'ipfs' as const
  readonly codec = CODECS.ipfs
  readonly capabilities = { nativeAccessControl: false, versionedRevocation: false }

  constructor(private readonly store: ByteStore = new Map<string, Uint8Array>()) {}

  async put(bytes: Uint8Array, ctx: CollectionCtx): Promise<StorageRef> {
    if (ctx.plaintext) { const ref = cidV1(bytes); this.store.set(ref, bytes); return { kind: 'ipfs', ref } }
    if (!ctx.contentKey) {
      throw new StorageError('MemoryAdapter.put requires ctx.contentKey')
    }
    const ciphertext = encryptBytes(bytes, ctx.contentKey)
    const ref = cidV1(ciphertext)
    this.store.set(ref, ciphertext)
    return { kind: 'ipfs', ref }
  }

  async get(ref: StorageRef, as: Identity): Promise<Uint8Array> {
    const ciphertext = this.store.get(ref.ref)
    if (!ciphertext) throw new StorageError(`no object stored at ${ref.ref}`)
    if (as.plaintext) return ciphertext
    const key = as.contentKey
      ? as.contentKey
      : as.wrappedKey && as.privateKey
        ? unwrapKey(as.wrappedKey, as.privateKey)
        : null
    if (!key) throw new StorageError('Identity must carry a contentKey or wrappedKey+privateKey')
    try {
      return decryptBytes(ciphertext, key)
    } catch (e) {
      throw new StorageError('content key does not match — the collection has been re-keyed', e)
    }
  }

  async grant(ref: StorageRef, pubkeys: Hex[], ctx: CollectionCtx): Promise<GrantResult> {
    if (!ctx.contentKey) throw new StorageError('grant requires ctx.contentKey')
    return {
      ref,
      wrapped: pubkeys.map((pubkey) => ({ pubkey, wrappedKey: wrapKey(ctx.contentKey!, pubkey) })),
    }
  }

  async revoke(
    ref: StorageRef,
    pubkeys: Hex[],
    ctx: CollectionCtx & { remaining?: Hex[] },
  ): Promise<GrantResult> {
    if (!ctx.contentKey) throw new StorageError('revoke requires ctx.contentKey')
    const removed = new Set(pubkeys.map((p) => p.toLowerCase()))
    const remaining = (ctx.remaining ?? []).filter((p) => !removed.has(p.toLowerCase()))

    const plaintext = await this.get(ref, { contentKey: ctx.contentKey })
    const next = rekey(plaintext, remaining)
    const newRef = cidV1(next.ciphertext)
    this.store.set(newRef, next.ciphertext)

    return {
      ref: { kind: 'ipfs', ref: newRef },
      wrapped: next.wrapped,
      contentKey: next.contentKey,
    }
  }

  toContenthash(ref: StorageRef): Hex {
    return encodeContenthash(CODECS.ipfs, ref.ref)
  }

  fromContenthash(hash: Hex): StorageRef {
    const { codec, ref } = decodeContenthash(hash)
    if (codec !== CODECS.ipfs) throw new StorageError(`expected ipfs, got ${codec}`)
    return { kind: 'ipfs', ref }
  }
}
