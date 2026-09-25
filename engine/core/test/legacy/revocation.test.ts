import { describe, expect, it } from 'vitest'
import {
  failClosedNotice,
  filterRevoked,
  isFresh,
  MAX_REVOKED_IDS,
  mayServe,
  parseRevoked,
  REVOCATION_CACHE_MS,
  revocationNotice,
  serialiseRevoked,
  type RevocationCheck,
} from '../src/index.js'

const ok = (ids: string[]): RevocationCheck => ({
  ok: true,
  revoked: new Set(ids),
  checkedAt: Date.now(),
})
const failed: RevocationCheck = { ok: false, error: 'rpc timeout', checkedAt: Date.now() }

describe('the revoked record', () => {
  it('round-trips a list of ids', () => {
    expect(parseRevoked(serialiseRevoked(['b', 'a']))).toEqual(['a', 'b'])
  })

  it('tolerates whitespace and empty segments', () => {
    expect(parseRevoked(' a , ,b ,')).toEqual(['a', 'b'])
  })

  it('treats an unset record as nothing revoked', () => {
    expect(parseRevoked('')).toEqual([])
  })

  it('throws past the cap rather than truncating', () => {
    const many = Array.from({ length: MAX_REVOKED_IDS + 1 }, (_, i) => `skill-${i}`)
    // Truncating would leave a revoked skill quietly being served.
    expect(() => serialiseRevoked(many)).toThrow(/exceeds/)
  })

  it('accepts exactly the cap', () => {
    const exact = Array.from({ length: MAX_REVOKED_IDS }, (_, i) => `skill-${i}`)
    expect(parseRevoked(serialiseRevoked(exact))).toHaveLength(MAX_REVOKED_IDS)
  })
})

describe('serving decisions', () => {
  it('withholds a revoked entry', () => {
    expect(mayServe(ok(['bad']), 'bad')).toBe(false)
    expect(mayServe(ok(['bad']), 'good')).toBe(true)
  })

  it('fails closed when the check itself failed', () => {
    // The critical property: a failed read must not read as "nothing revoked",
    // or disrupting the RPC would re-enable every revoked skill.
    expect(mayServe(failed, 'anything')).toBe(false)
  })

  it('withholds everything from a collection whose check failed', () => {
    const entries = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const { served, withheld } = filterRevoked(failed, entries)
    expect(served).toEqual([])
    expect(withheld).toHaveLength(3)
  })

  it('splits served from withheld on a successful check', () => {
    const entries = [{ id: 'a' }, { id: 'bad' }, { id: 'c' }]
    const { served, withheld } = filterRevoked(ok(['bad']), entries)
    expect(served.map((e) => e.id)).toEqual(['a', 'c'])
    expect(withheld.map((e) => e.id)).toEqual(['bad'])
  })
})

describe('freshness', () => {
  it('reuses an answer inside the window', () => {
    expect(isFresh({ ...ok([]), checkedAt: Date.now() - 1000 })).toBe(true)
  })

  it('will not reuse a stale answer', () => {
    expect(isFresh({ ...ok([]), checkedAt: Date.now() - REVOCATION_CACHE_MS - 1 })).toBe(false)
  })

  it('caches for at most a minute', () => {
    // This window is the delay between a publisher revoking and subscribers
    // stopping, so it is deliberately short.
    expect(REVOCATION_CACHE_MS).toBeLessThanOrEqual(60_000)
  })
})

describe('notices', () => {
  it('names what was withheld and from where', () => {
    const n = revocationNotice('skills.acme.eth', [{ id: 'bad-skill', name: 'Bad Skill' }])
    expect(n).toContain('skills.acme.eth')
    expect(n).toContain('bad-skill')
    expect(n).toContain('overrides any pinned version')
  })

  it('says nothing when nothing was withheld', () => {
    expect(revocationNotice('x.eth', [])).toBe('')
  })

  it('explains a fail-closed result rather than looking like an outage', () => {
    const n = failClosedNotice('skills.acme.eth', 'rpc timeout')
    expect(n).toContain('Nothing from this collection is being served')
    expect(n).toContain('deliberate')
  })
})
