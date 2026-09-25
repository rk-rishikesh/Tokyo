import { describe, expect, it } from 'vitest'
import { generatePrivateKey } from 'viem/accounts'
import {
  decryptBytes,
  encryptBytes,
  generateContentKey,
  keysEqual,
  pubkeyFromRecord,
  pubkeyRecordFromPrivate,
  publicKeyFromPrivate,
  rekey,
  unwrapKey,
  wrapKey,
} from '../src/crypto.js'

const text = (s: string) => new TextEncoder().encode(s)
const str = (b: Uint8Array) => new TextDecoder().decode(b)

describe('AES-256-GCM', () => {
  it('round-trips', () => {
    const key = generateContentKey()
    const msg = text('reentrancy in Vault.withdraw')
    expect(str(decryptBytes(encryptBytes(msg, key), key))).toBe('reentrancy in Vault.withdraw')
  })

  it('rejects the wrong key', () => {
    const ct = encryptBytes(text('secret'), generateContentKey())
    expect(() => decryptBytes(ct, generateContentKey())).toThrow()
  })

  it('rejects tampered ciphertext, because GCM is authenticated', () => {
    const key = generateContentKey()
    const ct = encryptBytes(text('secret'), key)
    ct[ct.length - 1] ^= 0xff
    expect(() => decryptBytes(ct, key)).toThrow()
  })

  it('uses a fresh IV per encryption', () => {
    const key = generateContentKey()
    const a = encryptBytes(text('same'), key)
    const b = encryptBytes(text('same'), key)
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false)
  })

  it('refuses a key of the wrong length', () => {
    expect(() => encryptBytes(text('x'), new Uint8Array(16))).toThrow(/32 bytes/)
  })
})

describe('ECIES key wrapping', () => {
  it('round-trips a content key through a subscriber keypair', () => {
    const key = generateContentKey()
    const priv = generatePrivateKey()
    const unwrapped = unwrapKey(wrapKey(key, publicKeyFromPrivate(priv)), priv)
    expect(keysEqual(unwrapped, key)).toBe(true)
  })

  it('does not unwrap with someone else’s key', () => {
    const wrapped = wrapKey(generateContentKey(), publicKeyFromPrivate(generatePrivateKey()))
    expect(() => unwrapKey(wrapped, generatePrivateKey())).toThrow()
  })

  it('round-trips the resolver pubkey record halves', () => {
    const priv = generatePrivateKey()
    const { x, y } = pubkeyRecordFromPrivate(priv)
    expect(pubkeyFromRecord(x, y)).toBe(publicKeyFromPrivate(priv))
  })
})

describe('re-key on revoke', () => {
  it('invalidates the old wrapped key', () => {
    const oldKey = generateContentKey()
    const revoked = generatePrivateKey()
    const oldWrapped = wrapKey(oldKey, publicKeyFromPrivate(revoked))

    const kept = generatePrivateKey()
    const next = rekey(text('fresh intel'), [publicKeyFromPrivate(kept)])

    // The revoked subscriber can still unwrap their old key — nothing on chain
    // was deleted — but it no longer decrypts the current content.
    const stillUnwraps = unwrapKey(oldWrapped, revoked)
    expect(keysEqual(stillUnwraps, oldKey)).toBe(true)
    expect(() => decryptBytes(next.ciphertext, stillUnwraps)).toThrow()
  })

  it('lets every remaining subscriber read the new content', () => {
    const a = generatePrivateKey()
    const b = generatePrivateKey()
    const next = rekey(text('fresh intel'), [publicKeyFromPrivate(a), publicKeyFromPrivate(b)])
    for (const [i, priv] of [a, b].entries()) {
      const key = unwrapKey(next.wrapped[i]!.wrappedKey, priv)
      expect(str(decryptBytes(next.ciphertext, key))).toBe('fresh intel')
    }
  })

  it('produces a different content key every time', () => {
    const a = rekey(text('x'), [])
    const b = rekey(text('x'), [])
    expect(keysEqual(a.contentKey, b.contentKey)).toBe(false)
  })
})
