/**
 * The storage adapter interface.
 *
 * The interface owns **access control and contenthash encoding**, not just
 * bytes (PRD §7). That is deliberate: on Pinata the application encrypts and
 * wraps keys; on Swarm the protocol does it natively through ACT. An adapter
 * that only moved bytes would put Swarm's whole advantage out of reach.
 */
import type { Hex } from 'viem'
import type { CodecName } from './contenthash.js'

export type StorageKind = 'ipfs' | 'swarm'

export type StorageRef = {
  kind: StorageKind
  /** CID (ipfs) or swarm reference. */
  ref: string
  /** Swarm only: the ACT history address. */
  actHistory?: string
  /** Swarm only: the publisher public key ACT derives grantee keys against. */
  actPublisher?: string
}

/** Context a `put` needs about the collection it is writing for. */
export type CollectionCtx = {
  /** Fully-qualified collection name, e.g. "exploits.auditor.eth". */
  collection: string
  /**
   * The collection's symmetric content key. Required by adapters without native
   * access control; ignored by adapters that have it.
   */
  contentKey?: Uint8Array
  /**
   * Store the bytes as they are. For public knowledge namespaces (PRD §17):
   * anyone may read, so encryption would only hide the content from the very
   * agents it is published for. Never set for personal or private namespaces.
   */
  plaintext?: boolean
}

/**
 * Who is reading. Adapters need different proofs: the IPFS path needs a private
 * key to unwrap a content key, the Swarm path needs the publisher pubkey and a
 * history address.
 */
export type Identity = {
  /** The reader's secp256k1 private key (IPFS path). */
  privateKey?: Hex
  /** The content key, if already unwrapped (IPFS path). */
  contentKey?: Uint8Array
  /** The reader's wrapped key from `data: wrappedKey` (IPFS path). */
  wrappedKey?: Hex
  /** Timestamp to read the ACT history at (Swarm path). */
  timestamp?: number
  /** The object was stored in plaintext; return it as is. */
  plaintext?: boolean
}

/** A content key sealed to one subscriber, ready to write to their name. */
export type WrappedKey = {
  /** Subscriber's SEC1 public key. */
  pubkey: Hex
  /** ECIES-wrapped content key for `data: wrappedKey`. */
  wrappedKey: Hex
}

/**
 * Result of a grant or revoke.
 *
 * Carries both the (possibly new) ref and any wrapped keys the caller must
 * write on chain. The PRD's signature returns only a `StorageRef`, but its own
 * description of the Pinata path requires returning wrapped keys for the caller
 * to write to each subscription's `data: wrappedKey` — so the return type is
 * widened rather than smuggling the keys out some other way.
 *
 * On adapters with native access control, `wrapped` is empty: there is nothing
 * for the caller to write, because the protocol did it.
 */
export type GrantResult = {
  ref: StorageRef
  wrapped: WrappedKey[]
  /**
   * Set when the operation re-keyed. The caller must write this key to its own
   * secure storage and re-wrap for every remaining subscriber.
   */
  contentKey?: Uint8Array
}

export type StorageCapabilities = {
  /** The protocol enforces access control (Swarm ACT), not the application. */
  nativeAccessControl: boolean
  /**
   * Revocation is versioned: a revoked reader keeps what they already had
   * access to but cannot read newer versions.
   */
  versionedRevocation: boolean
}

export interface StorageAdapter {
  readonly kind: StorageKind
  readonly codec: CodecName
  readonly capabilities: StorageCapabilities

  /** Store bytes, applying whatever confidentiality this adapter provides. */
  put(bytes: Uint8Array, ctx: CollectionCtx): Promise<StorageRef>

  /** Fetch and reveal bytes for a given reader. */
  get(ref: StorageRef, as: Identity): Promise<Uint8Array>

  /** Give these public keys access. */
  grant(ref: StorageRef, pubkeys: Hex[], ctx: CollectionCtx): Promise<GrantResult>

  /**
   * Remove access for these public keys.
   *
   * On adapters without native access control this **must** re-key. A revoke
   * that only drops a wrapped key leaves the old content key working against
   * bytes the revoked reader already has — that is a security bug, not an
   * optimisation.
   */
  revoke(ref: StorageRef, pubkeys: Hex[], ctx: CollectionCtx): Promise<GrantResult>

  toContenthash(ref: StorageRef): Hex
  fromContenthash(hash: Hex): StorageRef
}

export class StorageError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message)
    this.name = 'StorageError'
  }
}
