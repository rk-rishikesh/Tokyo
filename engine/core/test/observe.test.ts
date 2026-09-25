import { describe, expect, it } from 'vitest'
import { newKnowledge, proposeMemory, type Snapshot } from '../src/knowledge/index.js'

const now = '2026-01-01T00:00:00Z'
const snap = (...ms: ReturnType<typeof newKnowledge>[]): Snapshot => Object.fromEntries(ms.map((m) => [m.id, m]))
const blue = newKnowledge({ claim: 'User prefers blue clothing', topic: 'fashion', confidence: 0.7, contributor: 'shop', now })

describe('observation → proposal', () => {
  it('adds when nothing similar exists', () => {
    const p = proposeMemory(snap(blue), { claim: 'User runs in Nike Pegasus', topic: 'shopping', confidence: 0.9, contributor: 'shop' })
    expect(p.action).toBe('add')
    expect(p.knowledge.sources[0]?.type).toBe('observation')
  })

  it('holds below the threshold', () => {
    const p = proposeMemory(snap(), { claim: 'User might like hats', topic: 'fashion', confidence: 0.5, contributor: 'shop' })
    expect(p.action).toBe('below-threshold')
    const q = proposeMemory(snap(), { claim: 'User might like hats', topic: 'fashion', confidence: 0.5, contributor: 'shop' }, { threshold: 0.4 })
    expect(q.action).toBe('add')
  })

  it('reinforces the same observation instead of duplicating', () => {
    const p = proposeMemory(snap(blue), { claim: 'user prefers BLUE clothing', topic: 'fashion', confidence: 0.9, contributor: 'shop' })
    expect(p.action).toBe('known')
    expect(p.knowledge.id).toBe(blue.id)
    expect(p.knowledge.confidence).toBe(0.9)
  })

  it('supersedes a similar, less confident memory in the same context', () => {
    const p = proposeMemory(snap(blue), { claim: 'User prefers dark blue clothing', topic: 'fashion', confidence: 0.85, contributor: 'shop' })
    expect(p.action).toBe('update')
    expect(p.existing?.id).toBe(blue.id)
    expect(p.knowledge.id).toBe(blue.id)
    expect(p.knowledge.claim).toBe('User prefers dark blue clothing')
  })

  it('flags a contradiction it is less sure about as a conflict', () => {
    const sure = { ...blue, confidence: 0.95 }
    const p = proposeMemory(snap(sure), { claim: 'User prefers red clothing', topic: 'fashion', confidence: 0.8, contributor: 'shop' })
    expect(p.action).toBe('conflict')
    expect(p.existing?.id).toBe(blue.id)
  })

  it('does not compare across contexts', () => {
    const p = proposeMemory(snap(blue), { claim: 'User prefers dark blue clothing', topic: 'home', confidence: 0.9, contributor: 'shop' })
    expect(p.action).toBe('add')
  })
})
