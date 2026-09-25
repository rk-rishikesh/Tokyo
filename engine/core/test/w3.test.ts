import { describe, expect, it } from 'vitest'
import {
  checkSubjectAddressing, combineConfidence, distinctSources, mergeClaim, newKnowledge, reviewChanges, sameClaim, threeWayMerge, blockingFindings,
  type Snapshot,
} from '../src/knowledge/index.js'

const now = '2026-09-17T00:00:00Z'
const snap = (...ks: ReturnType<typeof newKnowledge>[]): Snapshot => Object.fromEntries(ks.map((k) => [k.id, k]))

describe('W3 — multi-source merge', () => {
  it('confidence rises with independent evidence and is capped', () => {
    expect(combineConfidence([0.8, 0.8])).toBe(0.96)
    expect(combineConfidence([0.5])).toBe(0.5)
    expect(combineConfidence([0.99, 0.99, 0.99])).toBe(0.99)
  })
  it('same claim from a second source appends the source and raises confidence; same source does not', () => {
    const a = newKnowledge({ claim: 'Prefers vegetarian food', subject: 'Food', topic: 'food', confidence: 0.8, contributor: 'swiggy-agent', sources: [{ type: 'observation', kind: 'application', name: 'Swiggy', id: 'order-1' }], now })
    const b = newKnowledge({ claim: 'prefers vegetarian food', subject: 'Food', topic: 'food', confidence: 0.8, contributor: 'zomato-agent', sources: [{ type: 'observation', kind: 'application', name: 'Zomato', id: 'order-9' }], now })
    expect(a.id).toBe(b.id)
    const { merged, newSources } = mergeClaim(a, b)
    expect(newSources).toBe(1); expect(merged.sources).toHaveLength(2); expect(merged.confidence).toBe(0.96); expect(merged.contributor).toBe('swiggy-agent')
    const again = mergeClaim(merged, b)
    expect(again.newSources).toBe(0); expect(again.merged.confidence).toBe(0.96)
    expect(distinctSources([...a.sources, ...a.sources])).toHaveLength(1)
  })
  it('three-way merge treats the same claim added on both sides as evidence, not conflict', () => {
    const base: Snapshot = {}
    const o = newKnowledge({ claim: 'Water boils at 100 °C', topic: 'physics', contributor: 'a', sources: [{ type: 'book', name: 'Textbook A' }], now })
    const t = newKnowledge({ claim: 'Water boils at 100 °C', topic: 'physics', contributor: 'b', sources: [{ type: 'paper', name: 'Paper B' }], now })
    const r = threeWayMerge(base, snap(o), snap(t))
    expect(r.conflicts).toEqual([])
    expect(r.snapshot[o.id]?.sources).toHaveLength(2)
    expect(sameClaim(o, t)).toBe(true)
  })
  it('supersedes turns a contradiction into a supersession and explains the removal', () => {
    const old = newKnowledge({ claim: 'Prefers vegetarian food', subject: 'Food', topic: 'food', contributor: 'a', reviewers: ['r.eth'], now })
    const base = snap(old)
    const contra = newKnowledge({ claim: 'Eats chicken regularly', subject: 'Food', topic: 'food', confidence: 0.9, contributor: 'b', sources: [{ type: 'observation', name: 'Zomato' }], now })
    const f1 = reviewChanges(base, { ...base, [contra.id]: contra })
    expect(f1.map((f) => f.kind)).toEqual(['contradiction'])
    expect(blockingFindings(f1)).toHaveLength(1)
    const sup = newKnowledge({ claim: 'Eats chicken regularly', subject: 'Food', topic: 'food', confidence: 0.9, contributor: 'b', sources: [{ type: 'observation', name: 'Zomato' }], supersedes: old.id, now })
    const f2 = reviewChanges(base, { [sup.id]: sup })
    expect(f2.map((f) => f.kind)).toEqual(['supersession'])
    expect(blockingFindings(f2)).toHaveLength(0)
  })
})

describe('W1 — subject addressing', () => {
  it('warns on vendor- and agent-shaped children, not on subjects or top-level names', () => {
    expect(checkSubjectAddressing('swiggy.rishikesh.eth')?.reason).toBe('vendor')
    expect(checkSubjectAddressing('foodagent.rishikesh.eth')?.reason).toBe('agent-shaped')
    expect(checkSubjectAddressing('food.rishikesh.eth')).toBeNull()
    expect(checkSubjectAddressing('india.worldhistory.eth')).toBeNull()
    expect(checkSubjectAddressing('mem0.eth')).toBeNull()
    expect(checkSubjectAddressing('wikipedia.history.eth')?.reason).toBe('vendor')
  })
})
