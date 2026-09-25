import { describe, expect, it } from 'vitest'
import { generatePrivateKey } from 'viem/accounts'
import { publicKeyFromPrivate, generateContentKey } from '@knowledge01/core'
import { MemoryAdapter } from '../src/memory.js'
import { StorageError } from '../src/types.js'

const text = (s: string) => new TextEncoder().encode(s)
const str = (b: Uint8Array) => new TextDecoder().decode(b)

describe('storage adapter contract', () => {
  it('stores, encrypts and reads back', async () => {
    const a = new MemoryAdapter()
    const contentKey = generateContentKey()
    const ctx = { collection: 'exploits.auditor.eth', contentKey }

    const ref = await a.put(text('collection body'), ctx)
    expect(str(await a.get(ref, { contentKey }))).toBe('collection body')
  })

  it('refuses to store without a content key, rather than pinning plaintext', async () => {
    const a = new MemoryAdapter()
    await expect(a.put(text('x'), { collection: 's' })).rejects.toThrow(StorageError)
  })

  it('round-trips through a contenthash', async () => {
    const a = new MemoryAdapter()
    const contentKey = generateContentKey()
    const ref = await a.put(text('body'), { collection: 's', contentKey })
    expect(a.fromContenthash(a.toContenthash(ref)).ref).toBe(ref.ref)
  })

  it('grants by wrapping the content key to each subscriber', async () => {
    const a = new MemoryAdapter()
    const contentKey = generateContentKey()
    const ctx = { collection: 's', contentKey }
    const ref = await a.put(text('body'), ctx)

    const sub = generatePrivateKey()
    const { wrapped } = await a.grant(ref, [publicKeyFromPrivate(sub)], ctx)

    expect(str(await a.get(ref, { wrappedKey: wrapped[0]!.wrappedKey, privateKey: sub }))).toBe('body')
  })

  it('revoke re-keys: the revoked subscriber cannot read the new version', async () => {
    const a = new MemoryAdapter()
    const contentKey = generateContentKey()
    const ctx = { collection: 's', contentKey }
    const ref = await a.put(text('body v1'), ctx)

    const kept = generatePrivateKey()
    const revoked = generatePrivateKey()
    const keptPub = publicKeyFromPrivate(kept)
    const revokedPub = publicKeyFromPrivate(revoked)

    const granted = await a.grant(ref, [keptPub, revokedPub], ctx)
    const revokedWrapped = granted.wrapped.find((w) => w.pubkey === revokedPub)!.wrappedKey

    const result = await a.revoke(ref, [revokedPub], { ...ctx, remaining: [keptPub, revokedPub] })

    // The ref moved, because the bytes were re-encrypted under a new key.
    expect(result.ref.ref).not.toBe(ref.ref)
    expect(result.contentKey).toBeDefined()

    // The kept subscriber gets a fresh wrapped key and reads the new version.
    const keptWrapped = result.wrapped.find((w) => w.pubkey === keptPub)!.wrappedKey
    expect(str(await a.get(result.ref, { wrappedKey: keptWrapped, privateKey: kept }))).toBe('body v1')

    // The revoked subscriber has no new wrapped key at all...
    expect(result.wrapped.find((w) => w.pubkey === revokedPub)).toBeUndefined()
    // ...and their old one no longer decrypts the current version.
    await expect(
      a.get(result.ref, { wrappedKey: revokedWrapped, privateKey: revoked }),
    ).rejects.toThrow(/re-keyed/)
  })

  it('reports its capabilities honestly', () => {
    const a = new MemoryAdapter()
    expect(a.capabilities.nativeAccessControl).toBe(false)
    expect(a.capabilities.versionedRevocation).toBe(false)
  })
})
