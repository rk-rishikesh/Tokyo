import { describe, expect, it } from 'vitest'
import {
  CODECS,
  decodeContenthash,
  encodeContenthash,
  normaliseRef,
} from '../src/contenthash.js'

const CID_V1 = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
const CID_V0 = 'QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnR'
const SWARM = 'd1f25a870a7bb7e5d526a7623338e4e9b8399e76df8b634020d11d969594f24e'

describe('ipfs contenthash', () => {
  it('round-trips a CIDv1', () => {
    const hash = encodeContenthash(CODECS.ipfs, CID_V1)
    expect(decodeContenthash(hash)).toEqual({ codec: 'ipfs', ref: CID_V1 })
  })

  it('uses the ipfs multicodec prefix 0xe3', () => {
    expect(encodeContenthash(CODECS.ipfs, CID_V1).startsWith('0xe3')).toBe(true)
  })

  it('normalises a CIDv0 to CIDv1, so refs compare as strings', () => {
    expect(normaliseRef(CODECS.ipfs, CID_V0)).toBe(CID_V1)
    expect(decodeContenthash(encodeContenthash(CODECS.ipfs, CID_V0)).ref).toBe(CID_V1)
  })
})

describe('swarm contenthash', () => {
  it('round-trips a swarm reference', () => {
    const hash = encodeContenthash(CODECS.swarm, SWARM)
    expect(decodeContenthash(hash)).toEqual({ codec: 'swarm', ref: SWARM })
  })

  it('uses the swarm multicodec prefix 0xe4', () => {
    expect(encodeContenthash(CODECS.swarm, SWARM).startsWith('0xe4')).toBe(true)
  })
})

describe('the silent-garbage failure mode', () => {
  it('throws on the ENSIP-7 spelling rather than encoding garbage', () => {
    // content-hash v3 names the codecs "ipfs" and "swarm". Given "ipfs-ns" it
    // silently falls back to a default profile and returns a valid-looking
    // hash that decodes to nonsense. That must not be reachable from here.
    expect(() => encodeContenthash('ipfs-ns' as never, CID_V1)).toThrow(/Unknown contenthash codec/)
    expect(() => encodeContenthash('swarm-ns' as never, SWARM)).toThrow(/Unknown contenthash codec/)
  })

  it('rejects an empty contenthash', () => {
    expect(() => decodeContenthash('0x')).toThrow(/empty/)
  })

  it('rejects a contenthash with an unrecognised codec', () => {
    expect(() => decodeContenthash('0x9999999999')).toThrow()
  })
})
