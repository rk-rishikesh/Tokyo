/**
 * The portability claim, tested: an export from another assistant becomes
 * claims in namespaces the person owns, with the export cited on every one.
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Repository } from '@k01/repo'
import { applyImport, extractMemories, planImport, readExport, subjectFor, topicFor, VENDORS } from '../src/memory-export.js'

const scratch = () => { const d = mkdtempSync(join(tmpdir(), 'import-')); process.env.RECALL_CACHE_DIR = d; return d }

describe('reading an export', () => {
  it('finds remembered facts in several shapes and ignores conversation transcripts', () => {
    const chatgpt = { memories: [{ id: 'm1', memory: 'User prefers vegetarian food', created_at: '2026-03-04T10:00:00Z' }, { id: 'm2', memory: 'ok' }], conversations: [{ mapping: { x: { message: { content: { parts: ['a long transcript line that must never become a claim'] } } } } }] }
    const a = extractMemories(chatgpt)
    expect(a.memories.map((m) => m.text)).toEqual(['User prefers vegetarian food'])
    expect(a.skipped).toBe(1)
    expect(a.from).toBe('memories')

    expect(extractMemories(['Prefers Vitest over Jest for tests']).memories).toHaveLength(1)
    expect(extractMemories([{ text: 'Works on ENS infrastructure', created: 1772000000 }]).memories[0]?.created).toMatch(/^2026-/)
  })

  it('prefers a memory-named container over a longer unrelated array', () => {
    const doc = { items: [{ content: 'some unrelated entry one' }, { content: 'some unrelated entry two' }, { content: 'some unrelated entry three' }], user_memories: [{ memory: 'User prefers concise answers' }] }
    expect(extractMemories(doc).from).toBe('user_memories')
  })

  it('reads JSON Lines and a directory', () => {
    const d = mkdtempSync(join(tmpdir(), 'exp-'))
    writeFileSync(join(d, 'mem.jsonl'), '{"fact":"User dislikes long meetings"}\n{"fact":"User prefers async updates"}\n')
    expect(extractMemories(readExport(join(d, 'mem.jsonl')).parsed).memories).toHaveLength(2)
    const dir = join(d, 'export'); mkdirSync(dir)
    writeFileSync(join(dir, 'conversations.json'), JSON.stringify([{ title: 'chat' }]))
    writeFileSync(join(dir, 'memories.json'), JSON.stringify([{ memory: 'User lives in Bengaluru' }]))
    expect(readExport(dir).file).toContain('memories.json')
    rmSync(d, { recursive: true, force: true })
  })
})

describe('routing and subjects', () => {
  it('routes on the strongest signal', () => {
    expect(topicFor('User prefers vegetarian food and avoids eggs')).toBe('food')
    expect(topicFor('User lives in Bengaluru and travels to Tokyo most years')).toBe('travel')
    expect(topicFor('Uses pnpm in a TypeScript monorepo')).toBe('code')
    expect(topicFor('Something entirely unclassifiable')).toBe('general')
  })
  it('makes a subject that names a thing, falling back to the topic', () => {
    expect(subjectFor('User prefers vegetarian food and avoids eggs')).toBe('Vegetarian food and')
    expect(subjectFor('User is a developer')).toBe('Developer')
    expect(subjectFor('I do')).toBe('General')  // nothing left after stripping the verb phrase
  })
})

describe('planning and applying', () => {
  it('splits by topic into subject-addressed namespaces and cites the vendor on every claim', () => {
    const d = scratch()
    const parsed = { memories: [{ memory: 'User prefers vegetarian food', id: 'm1' }, { memory: 'Uses pnpm and TypeScript', id: 'm2' }] }
    const plan = planImport(parsed, { vendor: VENDORS.chatgpt!, file: 'x.json', owner: 'alice.eth', namespace: '', split: true })
    expect(Object.keys(plan.byNamespace).sort()).toEqual(['code.alice.eth', 'food.alice.eth'])
    const item = plan.byNamespace['food.alice.eth']![0]!.item
    expect(item.sources[0]).toMatchObject({ kind: 'application', name: 'ChatGPT', id: 'm1', excerpt: 'User prefers vegetarian food' })
    expect(item.contributor).toBe('alice.eth')
    rmSync(d, { recursive: true, force: true })
  })

  it('first import commits to an empty namespace; a later one goes through propose; the same fact merges', () => {
    const d = scratch()
    const repo = Repository.init('food.alice.eth', 'alice.eth', { contentKey: '11'.repeat(32), kind: 'personal' })
    const plan1 = planImport({ memories: [{ memory: 'User prefers vegetarian food' }] }, { vendor: VENDORS.chatgpt!, file: 'x', owner: 'alice.eth', namespace: 'food.alice.eth' })
    const r1 = applyImport(repo, plan1.byNamespace['food.alice.eth']!, VENDORS.chatgpt!)
    expect(r1.commit).toBeDefined(); expect(r1.proposal).toBeUndefined(); expect(repo.version('main')).toBe(1)

    const plan2 = planImport({ memories: [{ memory: 'User avoids eggs entirely' }] }, { vendor: VENDORS.claude!, file: 'y', owner: 'alice.eth', namespace: 'food.alice.eth' })
    const r2 = applyImport(repo, plan2.byNamespace['food.alice.eth']!, VENDORS.claude!)
    expect(r2.proposal?.status).toBe('committed')
    expect(repo.version('main')).toBe(2)
    expect(repo.branch).toBe('main')

    const plan3 = planImport({ memories: [{ memory: 'User prefers vegetarian food' }] }, { vendor: VENDORS.instinct!, file: 'z', owner: 'alice.eth', namespace: 'food.alice.eth' })
    applyImport(repo, plan3.byNamespace['food.alice.eth']!, VENDORS.instinct!)
    const veg = Object.values(repo.headSnapshot('main')).find((k) => k.claim.includes('vegetarian'))!
    expect(veg.sources.map((s) => s.name).sort()).toEqual(['ChatGPT', 'Instinct'])
    expect(veg.confidence).toBeGreaterThan(0.7)
    rmSync(d, { recursive: true, force: true })
  })
})
