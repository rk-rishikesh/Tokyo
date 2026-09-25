/**
 * Content encryption and key wrapping for the app-side (Pinata) access path.
 *
 * Shape:
 *   - a collection has one symmetric **content key** (AES-256-GCM)
 *   - the ciphertext is what gets pinned
 *   - each subscriber gets that content key ECIES-wrapped to their own pubkey,
 *     written to their subscription's `data: wrappedKey` record
 *
 * Revocation **always re-keys** (PRD §7). Removing a wrapped key alone leaves
 * the old content key valid against already-fetched ciphertext, which is not
 * revocation — it is the appearance of it. `rekey` exists so there is no
 * convenient way to do the wrong thing.
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'
import { decrypt as eciesDecrypt, encrypt as eciesEncrypt } from 'eciesjs'
import { bytesToHex, hexToBytes, type Hex } from 'viem'
import { secp256k1 } from '@noble/curves/secp256k1'

const ALGORITHM = 'aes-256-gcm'
const KEY_BYTES = 32
const IV_BYTES = 12
const TAG_BYTES = 16

/** A collection content key. 32 bytes. */
export type ContentKey = Uint8Array

/** Generate a fresh content key. */
export function generateContentKey(): ContentKey {
  return new Uint8Array(randomBytes(KEY_BYTES))
}

/**
 * Encrypt with AES-256-GCM.
 *
 * Output layout is `iv (12) || ciphertext || tag (16)` — self-describing, so
 * decrypt needs nothing but the key.
 */
export function encryptBytes(plaintext: Uint8Array, key: ContentKey): Uint8Array {
  if (key.length !== KEY_BYTES) {
    throw new Error(`content key must be ${KEY_BYTES} bytes, got ${key.length}`)
  }
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return new Uint8Array(Buffer.concat([iv, ciphertext, tag]))
}

/** Decrypt the `iv || ciphertext || tag` layout produced by `encryptBytes`. */
export function decryptBytes(payload: Uint8Array, key: ContentKey): Uint8Array {
  if (key.length !== KEY_BYTES) {
    throw new Error(`content key must be ${KEY_BYTES} bytes, got ${key.length}`)
  }
  if (payload.length < IV_BYTES + TAG_BYTES) {
    throw new Error('ciphertext too short to contain iv and tag')
  }
  const buf = Buffer.from(payload)
  const iv = buf.subarray(0, IV_BYTES)
  const tag = buf.subarray(buf.length - TAG_BYTES)
  const ciphertext = buf.subarray(IV_BYTES, buf.length - TAG_BYTES)

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  // Throws on tag mismatch — a wrong or revoked key fails here, loudly.
  return new Uint8Array(Buffer.concat([decipher.update(ciphertext), decipher.final()]))
}

// ---------------------------------------------------------------------------
// ECIES key wrapping (secp256k1)
// ---------------------------------------------------------------------------

/**
 * Wrap a content key to a subscriber's secp256k1 public key.
 *
 * `pubkey` is an uncompressed (65-byte, `0x04…`) or compressed (33-byte) SEC1
 * point. This is what goes into `data: wrappedKey` on the subscription name.
 */
export function wrapKey(contentKey: ContentKey, pubkey: Hex): Hex {
  const pub = hexToBytes(pubkey)
  if (pub.length !== 65 && pub.length !== 33) {
    throw new Error(`public key must be 33 or 65 bytes SEC1, got ${pub.length}`)
  }
  return bytesToHex(new Uint8Array(eciesEncrypt(pub, Buffer.from(contentKey))))
}

/** Unwrap a content key with the subscriber's private key. */
export function unwrapKey(wrapped: Hex, privateKey: Hex): ContentKey {
  const priv = hexToBytes(privateKey)
  if (priv.length !== 32) {
    throw new Error(`private key must be 32 bytes, got ${priv.length}`)
  }
  const key = new Uint8Array(eciesDecrypt(priv, Buffer.from(hexToBytes(wrapped))))
  if (key.length !== KEY_BYTES) {
    throw new Error(`unwrapped key has wrong length: ${key.length}`)
  }
  return key
}

/**
 * The uncompressed SEC1 point for a private key, split into the `x` and `y`
 * halves the resolver's `pubkey` record stores.
 */
export function pubkeyRecordFromPrivate(privateKey: Hex): { x: Hex; y: Hex } {
  const point = hexToBytes(publicKeyFromPrivate(privateKey))
  // point is 0x04 || x(32) || y(32)
  return {
    x: bytesToHex(point.slice(1, 33)),
    y: bytesToHex(point.slice(33, 65)),
  }
}

/** Rebuild an uncompressed SEC1 point from a resolver `pubkey` record. */
export function pubkeyFromRecord(x: Hex, y: Hex): Hex {
  const xb = hexToBytes(x)
  const yb = hexToBytes(y)
  if (xb.length !== 32 || yb.length !== 32) {
    throw new Error('pubkey record halves must be 32 bytes each')
  }
  const out = new Uint8Array(65)
  out[0] = 0x04
  out.set(xb, 1)
  out.set(yb, 33)
  return bytesToHex(out)
}

/** Uncompressed SEC1 public key for a private key. */
export function publicKeyFromPrivate(privateKey: Hex): Hex {
  return bytesToHex(secp256k1.getPublicKey(hexToBytes(privateKey), false))
}

// ---------------------------------------------------------------------------
// Re-keying
// ---------------------------------------------------------------------------

export type Rekeyed = {
  /** The new content key. The old one is now worthless against new ciphertext. */
  contentKey: ContentKey
  /** Re-encrypted payload, ready to pin. */
  ciphertext: Uint8Array
  /** Fresh wrapped keys, one per remaining subscriber. */
  wrapped: { pubkey: Hex; wrappedKey: Hex }[]
}

/**
 * Re-key a collection: new content key, re-encrypt, re-wrap for exactly the
 * subscribers passed in.
 *
 * Anyone not in `remainingPubkeys` is revoked — not because a record was
 * deleted, but because the bytes they can still fetch are encrypted under a key
 * that no longer decrypts anything new.
 */
export function rekey(plaintext: Uint8Array, remainingPubkeys: Hex[]): Rekeyed {
  const contentKey = generateContentKey()
  return {
    contentKey,
    ciphertext: encryptBytes(plaintext, contentKey),
    wrapped: remainingPubkeys.map((pubkey) => ({
      pubkey,
      wrappedKey: wrapKey(contentKey, pubkey),
    })),
  }
}

/** Constant-time comparison, for checking key equality without leaking timing. */
export function keysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

/**
 * Accept a private key with or without the `0x` prefix.
 *
 * Wallets and faucets export it both ways, and a bare 64-character hex string is
 * unambiguous. Rejecting one spelling produces a confusing "not a valid key"
 * error for a key that is perfectly valid, so normalise instead.
 *
 * Returns null for anything that is not 32 bytes of hex — this must not become a
 * lenient parser that accepts a truncated paste.
 */
export function normalisePrivateKey(raw: string | undefined): Hex | null {
  if (!raw) return null
  const trimmed = raw.trim().replace(/^["']|["']$/g, '')
  const body = trimmed.replace(/^0x/i, '')
  if (!/^[0-9a-fA-F]{64}$/.test(body)) return null
  return `0x${body.toLowerCase()}` as Hex
}
