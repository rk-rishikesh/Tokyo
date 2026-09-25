/**
 * ENSIP-7 contenthash encoding.
 *
 * Never hand-roll the multicodec prefix (rule 4) — `@ensdomains/content-hash`
 * owns it. But it has one sharp edge that costs hours:
 *
 * **`encode()` does not throw on an unknown codec name.** It falls back to a
 * "default" profile that hex-encodes the string and writes a zero varint code.
 * The result looks like a contenthash, writes to chain happily, and decodes to
 * garbage. In v3.x the codec names are `ipfs` and `swarm` — *not* the
 * `ipfs-ns` / `swarm-ns` spelling used in ENSIP-7 prose and in the PRD.
 *
 * So every call here goes through `assertCodec`, and both directions are
 * round-trip checked.
 */
import {
  cidForWeb as chCidForWeb,
  cidV0ToV1Base32,
  decode as chDecode,
  encode as chEncode,
  getCodec as chGetCodec,
} from '@ensdomains/content-hash'
import type { Hex } from 'viem'

/** Codec names this build accepts, as spelled by content-hash v3. */
export const CODECS = { ipfs: 'ipfs', swarm: 'swarm' } as const
export type CodecName = (typeof CODECS)[keyof typeof CODECS]

const VALID = new Set<string>(Object.values(CODECS))

function assertCodec(name: string): asserts name is CodecName {
  if (!VALID.has(name)) {
    throw new Error(
      `Unknown contenthash codec "${name}". Valid: ${[...VALID].join(', ')}. ` +
        `content-hash would silently encode this as garbage rather than throw.`,
    )
  }
}

/** Encode a ref to a `0x`-prefixed ENSIP-7 contenthash. */
export function encodeContenthash(codec: CodecName, ref: string): Hex {
  assertCodec(codec)
  if (!ref) throw new Error('cannot encode an empty ref')
  const encoded = `0x${chEncode(codec, ref)}` as Hex

  // Round-trip immediately: the failure mode is silent, so make it loud here.
  const actual = chGetCodec(encoded)
  if (actual !== codec) {
    throw new Error(
      `contenthash encode produced codec "${actual}" for "${codec}" — refusing to return it`,
    )
  }
  return encoded
}

/** Decode a contenthash into its codec and ref. */
export function decodeContenthash(hash: Hex): { codec: CodecName; ref: string } {
  if (!hash || hash === '0x') throw new Error('empty contenthash')
  const codec = chGetCodec(hash)
  if (!codec) {
    throw new Error(`contenthash ${hash.slice(0, 20)}… has no recognisable codec`)
  }
  assertCodec(codec)
  return { codec, ref: chDecode(hash) }
}

/**
 * Normalise an IPFS ref to the form `decode()` returns.
 *
 * CIDv0 (`Qm…`) is normalised to CIDv1 base32 (`bafy…`) on decode, so the same
 * content can be spelled two ways. Ref strings are compared as strings in the
 * fast-forward check — a proposal recording a v0 parent against a v1 current
 * would read as stale when it is not. Everything that stores or compares a ref
 * passes through here first.
 */
export function normaliseRef(codec: CodecName, ref: string): string {
  assertCodec(codec)
  if (codec !== CODECS.ipfs) return ref
  if (!ref.startsWith('Qm')) return ref
  return cidV0ToV1Base32(ref)
}

/** A gateway-friendly CID, for building an HTTP URL. */
export function cidForWeb(cid: string): string {
  return chCidForWeb(cid)
}
