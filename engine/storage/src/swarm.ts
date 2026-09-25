/**
 * Swarm adapter — the target storage path (PRD §7, milestone M6).
 *
 * Where Pinata needs the application to encrypt and wrap keys, Swarm's Access
 * Control Trie (ACT) does it in the protocol. Upload with the ACT flag and a
 * history address; download needs the publisher's public key, that history
 * address, and a timestamp. Grantee management is a patch with `add` and
 * `revoke` lists of public keys, and each grantee's access key is derived for
 * them by Diffie-Hellman against their own key.
 *
 * `nativeAccessControl: true`, `versionedRevocation: true`.
 *
 * **ACT history is a feature, not a limitation.** A revoked grantee keeps the
 * version they were granted and is blocked from newer ones. That is exactly the
 * semantic a lapsed subscription wants, so it is not worked around.
 *
 * The publisher pubkey and history address do not fit in a contenthash, so they
 * live in `text: recall.actPublisher` and `text: recall.actHistory` on the collection.
 */
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

export type SwarmConfig = {
  /** Bee node API, e.g. http://localhost:1633 */
  apiUrl: string
  postageBatchId: string
}

/**
 * Two grantee-list updates inside the same second fail: the history key is a
 * timestamp, and the duplicate is rejected. Grant and revoke are serialised
 * through `withGranteeGap` with a margin over one second.
 */
const GRANTEE_UPDATE_GAP_MS = 1100

export class SwarmAdapter implements StorageAdapter {
  readonly kind = 'swarm' as const
  readonly codec = CODECS.swarm
  readonly capabilities = { nativeAccessControl: true, versionedRevocation: true }

  private lastGranteeUpdate = 0
  private granteeQueue: Promise<unknown> = Promise.resolve()

  constructor(private readonly config: SwarmConfig) {
    if (!config.apiUrl) throw new StorageError('BEE_API_URL is required')
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    if (!this.config.postageBatchId) {
      throw new StorageError('BEE_POSTAGE_BATCH_ID is required to write to Swarm')
    }
    return { 'swarm-postage-batch-id': this.config.postageBatchId, ...extra }
  }

  /**
   * Upload under ACT.
   *
   * No application-side encryption: `ctx.contentKey` is ignored by design. ACT
   * encrypts the payload and manages the access key, which is the whole reason
   * this adapter exists.
   */
  async put(bytes: Uint8Array, ctx: CollectionCtx): Promise<StorageRef> {
    const res = await fetch(`${this.config.apiUrl}/bzz`, {
      method: 'POST',
      headers: this.headers({
        'content-type': 'application/octet-stream',
        'swarm-act': 'true',
        'swarm-collection': 'false',
        ...(ctx.collection ? { 'swarm-index-document': `${ctx.collection}.recall` } : {}),
      }),
      body: bytes as BodyInit,
    })
    if (!res.ok) {
      throw new StorageError(`Swarm ACT upload failed: ${res.status} ${await res.text()}`)
    }
    const body = (await res.json()) as { reference?: string }
    const actHistory = res.headers.get('swarm-act-history-address') ?? undefined
    const actPublisher = res.headers.get('swarm-act-publisher') ?? undefined
    if (!body.reference) throw new StorageError('Swarm upload returned no reference')

    return {
      kind: 'swarm',
      ref: body.reference,
      ...(actHistory ? { actHistory } : {}),
      ...(actPublisher ? { actPublisher } : {}),
    }
  }

  /**
   * Download through ACT.
   *
   * The timestamp selects the point in the history to read at. A grantee
   * revoked after that point can still read this version — which is the
   * subscription semantic we want, not a bug to route around.
   */
  async get(ref: StorageRef, as: Identity): Promise<Uint8Array> {
    if (ref.kind !== 'swarm') {
      throw new StorageError(`SwarmAdapter cannot read a "${ref.kind}" ref`)
    }
    if (!ref.actHistory || !ref.actPublisher) {
      throw new StorageError(
        'An ACT download needs both actHistory and actPublisher. They do not fit in a ' +
          'contenthash — read them from text: recall.actHistory and text: recall.actPublisher.',
      )
    }
    const timestamp = as.timestamp ?? Math.floor(Date.now() / 1000)
    const res = await fetch(`${this.config.apiUrl}/bzz/${ref.ref}/`, {
      headers: {
        'swarm-act': 'true',
        'swarm-act-history-address': ref.actHistory,
        'swarm-act-publisher': ref.actPublisher,
        'swarm-act-timestamp': String(timestamp),
      },
    })
    if (res.status === 401 || res.status === 403) {
      throw new StorageError(
        'ACT denied access to this reference — the reader is not a grantee at this timestamp',
      )
    }
    if (!res.ok) {
      throw new StorageError(`Swarm download failed: ${res.status} ${await res.text()}`)
    }
    return new Uint8Array(await res.arrayBuffer())
  }

  async grant(ref: StorageRef, pubkeys: Hex[]): Promise<GrantResult> {
    return this.patchGrantees(ref, { add: pubkeys })
  }

  /**
   * Revoke through ACT.
   *
   * No re-key and no re-upload: ACT rotates the access key itself and records
   * the change in the history. `wrapped` comes back empty because there is
   * nothing for the caller to write on chain — the protocol did the work.
   */
  async revoke(ref: StorageRef, pubkeys: Hex[]): Promise<GrantResult> {
    return this.patchGrantees(ref, { revoke: pubkeys })
  }

  toContenthash(ref: StorageRef): Hex {
    if (ref.kind !== 'swarm') {
      throw new StorageError(`SwarmAdapter cannot encode a "${ref.kind}" ref`)
    }
    return encodeContenthash(CODECS.swarm, ref.ref)
  }

  /**
   * Decode a swarm contenthash.
   *
   * The result deliberately has no `actHistory` / `actPublisher`: a contenthash
   * cannot carry them. The caller must fill them in from the collection's text
   * records before attempting a read.
   */
  fromContenthash(hash: Hex): StorageRef {
    const { codec, ref } = decodeContenthash(hash)
    if (codec !== CODECS.swarm) {
      throw new StorageError(`expected a swarm contenthash, got "${codec}"`)
    }
    return { kind: 'swarm', ref }
  }

  // -------------------------------------------------------------------------

  /**
   * Serialise grantee updates with a gap of over one second.
   *
   * The history key is a timestamp with one-second resolution, so two updates
   * inside the same second collide and the second is rejected.
   */
  private withGranteeGap<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.granteeQueue.then(async () => {
      const wait = GRANTEE_UPDATE_GAP_MS - (Date.now() - this.lastGranteeUpdate)
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      try {
        return await fn()
      } finally {
        this.lastGranteeUpdate = Date.now()
      }
    })
    this.granteeQueue = run.catch(() => undefined)
    return run
  }

  private patchGrantees(
    ref: StorageRef,
    patch: { add?: Hex[]; revoke?: Hex[] },
  ): Promise<GrantResult> {
    if (!ref.actHistory) {
      throw new StorageError('grantee updates need the ACT history address')
    }
    return this.withGranteeGap(async () => {
      const res = await fetch(`${this.config.apiUrl}/grantee/${ref.actHistory}`, {
        method: 'PATCH',
        headers: this.headers({
          'content-type': 'application/json',
          'swarm-act-history-address': ref.actHistory!,
        }),
        body: JSON.stringify({
          ...(patch.add ? { add: patch.add } : {}),
          ...(patch.revoke ? { revoke: patch.revoke } : {}),
        }),
      })
      if (!res.ok) {
        throw new StorageError(
          `Swarm grantee patch failed: ${res.status} ${await res.text()}`,
        )
      }
      const body = (await res.json()) as { ref?: string; historyref?: string }
      return {
        // A grantee change produces a new history reference; the payload
        // reference is unchanged.
        ref: {
          ...ref,
          ...(body.historyref ? { actHistory: body.historyref } : {}),
        },
        // Nothing to write on chain: ACT owns access control.
        wrapped: [],
      }
    })
  }
}
