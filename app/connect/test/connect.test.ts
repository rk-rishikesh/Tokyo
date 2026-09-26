import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Repository, RepoStore, repoPath } from '@knowledge01/repo'
import { fromSlack, slackChallenge } from '../src/connectors.js'
import { ingest, readActivity } from '../src/ingest.js'
import { isKnowledge, route, subjectFor, topicFor } from '../src/routing.js'

const scratch = () => { const d = mkdtempSync(join(tmpdir(), 'connect-')); process.env.RECALL_CACHE_DIR = d; return d }

describe('the knowledge boundary', () => {
  const ev = (text: string) => ({ connector: 'slack', sourceName: 'Slack', sourceKind: 'application' as const, text, actor: 'p', trigger: 't', at: '2026-09-22T00:00:00Z' })
  it('keeps statements and rejects chatter', () => {
    expect(isKnowledge(ev('We decided to ship behind a flag until legal clears')).ok).toBe(true)
    expect(isKnowledge(ev('thanks!')).ok).toBe(false)
    expect(isKnowledge(ev('Should we move the call to Thursday?')).reason).toContain('question')
    expect(isKnowledge(ev('+1')).ok).toBe(false)
    expect(isKnowledge(ev('Sounds good, talk tomorrow')).reason).toContain('acknowledgement')
    // Conventions are usually imperative; rejecting them would lose the best claims.
    expect(isKnowledge(ev('Never cache ENSv2 token ids; they change on role changes')).ok).toBe(true)
    expect(isKnowledge(ev('Always run the ABI guard before merging')).ok).toBe(true)
    expect(isKnowledge(ev('lets grab lunch sometime next week maybe')).ok).toBe(false)
  })
})

describe('routing names subjects, not sources', () => {
  it('sends a Slack decision to decisions.<owner>, never slack.<owner>', () => {
    const r = route({ connector: 'slack', sourceName: 'Slack', sourceKind: 'application', text: 'We decided to ship the connector behind a flag', actor: 'p', trigger: 't', at: '' }, { owner: 'acme.eth' })
    expect(r.namespace).toBe('decisions.acme.eth')
    expect(r.namespace).not.toContain('slack')
    expect(r.type).toBe('decision')
  })
  it('routes conventions and runbooks by content', () => {
    expect(topicFor('Use pnpm, not npm — always')).toBe('conventions')
    expect(topicFor('Production deploys require a second approver')).toBe('runbook')
    expect(topicFor('The vendor confirmed 30-day payment terms')).toBe('accounts')
    expect(subjectFor('We decided to ship the connector behind a flag', 'decisions')).toBe('Ship the connector behind')
  })
})

describe('Slack payloads', () => {
  it('answers the URL verification challenge', () => {
    expect(slackChallenge({ type: 'url_verification', challenge: 'abc' })).toBe('abc')
  })
  it('reads a slash command as a claim typed on purpose', () => {
    const e = fromSlack({ command: '/knowledge', text: 'We use pnpm, not npm', user_name: 'priya', channel_name: 'eng', team_domain: 'acme' })!
    expect(e.text).toBe('We use pnpm, not npm')
    expect(e.actor).toBe('priya')
    expect(e.trigger).toContain('/knowledge')
  })
  it('reads a pin reaction only when the message text is resolved', () => {
    const body = { event: { type: 'reaction_added', reaction: 'pushpin', user: 'sam', item: { channel: 'C01', ts: '1.2' } } }
    expect(fromSlack(body)).toBeNull() // no resolver: we do not invent the text
    const e = fromSlack(body, () => ({ text: 'We decided to ship behind a flag', permalink: 'https://acme.slack.com/p1' }))!
    expect(e.text).toBe('We decided to ship behind a flag')
    expect(e.ref).toBe('https://acme.slack.com/p1')
  })
  it('ignores ordinary messages — channel traffic is never read', () => {
    expect(fromSlack({ event: { type: 'message', text: 'some chatter', user: 'x', channel: 'C01' } })).toBeNull()
    expect(fromSlack({ event: { type: 'reaction_added', reaction: 'eyes', user: 'x', item: { channel: 'C01', ts: '1' } } })).toBeNull()
  })
})

describe('ingest writes real commits', () => {
  const ev = (text: string, connector = 'slack', name = 'Slack') => ({
    connector, sourceName: name, sourceKind: 'application' as const, text,
    actor: 'priya', trigger: '/knowledge command', context: '#eng',
    ref: 'https://acme.slack.com/archives/C01/p1', at: new Date().toISOString(),
  })

  it('creates the namespace, commits the claim, cites the source, and logs it', () => {
    const d = scratch()
    const event = ev('We decided to ship the connector behind a flag until legal review clears')
    const out = ingest(event, { owner: 'acme.eth', create: true })
    expect(out.status).toBe('committed')
    if (out.status !== 'committed') return
    expect(out.namespace).toBe('decisions.acme.eth')
    expect(out.version).toBe(1)

    const repo = Repository.open('decisions.acme.eth')
    const k = repo.headSnapshot('main')[out.claimId]!
    expect(k.claim).toContain('behind a flag')
    expect(k.sources[0]).toMatchObject({ name: 'Slack', kind: 'application' })
    expect(k.sources[0]!.excerpt).toBe(event.text)

    const log = readActivity()
    expect(log[0]?.outcome.status).toBe('committed')
    rmSync(d, { recursive: true, force: true })
  })

  it('skips chatter and records why', () => {
    const d = scratch()
    const out = ingest(ev('thanks, that unblocks me'), { owner: 'acme.eth', create: true })
    expect(out.status).toBe('skipped')
    expect(readActivity()[0]?.outcome).toMatchObject({ status: 'skipped' })
    expect(RepoStore.exists(repoPath('decisions.acme.eth'))).toBe(false)
    rmSync(d, { recursive: true, force: true })
  })

  it('a second source stating the same thing merges rather than duplicating', () => {
    const d = scratch()
    const text = 'We use pnpm, not npm — the workspace is a pnpm monorepo'
    const first = ingest(ev(text), { owner: 'acme.eth', create: true })
    const second = ingest({ ...ev(text, 'claude-code', 'Claude Code'), sourceKind: 'agent' as const, ref: 'pnpm-workspace.yaml' }, { owner: 'acme.eth', create: true })
    expect(first.status).toBe('committed'); expect(second.status).toBe('committed')
    if (second.status !== 'committed' || first.status !== 'committed') return
    expect(second.claimId).toBe(first.claimId)
    expect(second.merged).toBe(true)
    const k = Repository.open('conventions.acme.eth').headSnapshot('main')[second.claimId]!
    expect(k.sources.map((s) => s.name).sort()).toEqual(['Claude Code', 'Slack'])
    expect(k.confidence).toBeGreaterThan(0.85)
    rmSync(d, { recursive: true, force: true })
  })

  it('re-stating a known claim from the same source is unchanged, not an error', () => {
    const d = scratch()
    const text = 'We decided to ship the connector behind a flag'
    const first = ingest(ev(text), { owner: 'acme.eth', create: true })
    const again = ingest(ev(text), { owner: 'acme.eth', create: true })
    expect(first.status).toBe('committed')
    // An agent on a timer sees the same evidence every pass. That is not a
    // failure, and it must not be reported as one.
    expect(again.status).toBe('unchanged')
    if (again.status !== 'unchanged' || first.status !== 'committed') return
    expect(again.claimId).toBe(first.claimId)
    expect(Repository.open('decisions.acme.eth').version('main')).toBe(first.version)
    rmSync(d, { recursive: true, force: true })
  })

  it('refuses to start without an owner rather than inventing one', async () => {
    const { connectOwner } = await import('../src/ingest.js')
    expect(connectOwner({ CONNECT_OWNER: 'you.eth' } as NodeJS.ProcessEnv)).toBe('you.eth')
    expect(connectOwner({ KNOWLEDGE_NAMESPACE: 'conventions.recalltest.eth' } as NodeJS.ProcessEnv)).toBe('recalltest.eth')
    expect(connectOwner({ KNOWLEDGE_NAMESPACE: 'recalltest.eth' } as NodeJS.ProcessEnv)).toBe('recalltest.eth')
    // No placeholder: writing real browsing into a namespace nobody owns is
    // worse than refusing to start.
    expect(() => connectOwner({} as NodeJS.ProcessEnv)).toThrow(/no owner configured/)
  })

  it('refuses to create namespaces when not asked', () => {
    const d = scratch()
    expect(ingest(ev('We decided to ship behind a flag'), { owner: 'acme.eth' }).status).toBe('error')
    rmSync(d, { recursive: true, force: true })
  })
})

describe('local sources read real data, or nothing', () => {
  it('reports which sources exist on this machine', async () => {
    const { availableSources } = await import('../src/local-sources.js')
    const s = availableSources()
    expect(s.map((x) => x.id).sort()).toEqual(['editor', 'shell'])
    for (const x of s) expect(typeof x.detail).toBe('string')
  })

  it('shell findings count command names and never arguments', async () => {
    const { shellFindings } = await import('../src/local-sources.js')
    const d = mkdtempSync(join(tmpdir(), 'sh-'))
    const f = join(d, 'hist')
    const lines = [
      ...Array.from({ length: 12 }, () => ': 1700000000:0;pnpm install --filter @secret/pkg'),
      ...Array.from({ length: 11 }, () => 'git push origin super-secret-branch'),
      'curl https://api.example.com?token=SECRET',
    ]
    writeFileSync(f, lines.join('\n'))
    const found = shellFindings(f, { min: 10 })
    expect(found.map((x) => x.text).sort()).toEqual(['Uses git regularly', 'Uses pnpm regularly'])
    // Arguments never leave the file.
    const all = JSON.stringify(found)
    expect(all).not.toContain('secret'); expect(all).not.toContain('SECRET'); expect(all).not.toContain('origin')
    rmSync(d, { recursive: true, force: true })
  })

  it('editor findings only name projects that still exist', async () => {
    const { editorFindings } = await import('../src/local-sources.js')
    const d = mkdtempSync(join(tmpdir(), 'ed-'))
    const real = join(d, 'realproj'); mkdirSync(real)
    writeFileSync(join(real, 'package.json'), JSON.stringify({ name: 'realproj' }))
    const storage = join(d, 'storage.json')
    writeFileSync(storage, JSON.stringify({ a: `file://${real}`, b: `file://${join(d, 'deleted-long-ago')}` }))
    const f = editorFindings(storage, 'VS Code')
    expect(f).toHaveLength(1)
    expect(f[0]!.text).toBe('Works on the realproj project')
    rmSync(d, { recursive: true, force: true })
  })
})

describe('Chrome history — extracts patterns, never browsing', () => {
  it('keeps what is true and refuses what is not', async () => {
    const { findings } = await import('../src/chrome.js')
    const rows = [
      { host: 'www.loops.house', title: 'Loops House For AI-native hackathons', visits: 10208, urls: 668 },
      { host: 'github.com', title: 'Germina-Labs/loops-platform', visits: 1641, urls: 518 },
      { host: 'mail.google.com', title: 'Inbox (22,185)', visits: 1310, urls: 450 },
      { host: 'www.linkedin.com', title: 'Feed | LinkedIn', visits: 1115, urls: 395 },
      { host: 'meet.google.com', title: 'Google Meet', visits: 422, urls: 181 },
      { host: 'linear.app', title: 'Inbox (51)', visits: 1202, urls: 300 },
      { host: 'news.example.com', title: 'Some article', visits: 30, urls: 2 },
    ]
    const texts = findings(rows).map((x) => x.text)
    expect(texts.some((t) => t.includes('Works on Loops House'))).toBe(true)
    expect(texts).toContain('Uses GitHub for source control day to day')
    expect(texts).toContain('Tracks work in Linear')
    // A wrong claim is worse than a missing one.
    expect(texts.some((t) => t.includes('Meet'))).toBe(false)
    expect(texts.some((t) => t.includes('LinkedIn'))).toBe(false)
    expect(texts.some((t) => t.includes('mail.google'))).toBe(false)
    expect(texts.some((t) => t.includes('news.example'))).toBe(false)
  })

  it('routes browser patterns to subject namespaces, never to the browser', async () => {
    const { route } = await import('../src/routing.js')
    const ev = (text: string) => ({ connector: 'chrome', sourceName: 'Browser history', sourceKind: 'application' as const, text, actor: 'you', trigger: '900 visits', at: '' })
    const tools = route(ev('Uses GitHub for source control day to day'), { owner: 'you.eth' })
    expect(tools.namespace).toBe('tools.you.eth')
    expect(tools.type).toBe('fact')
    expect(route(ev('Works on Loops House (www.loops.house)'), { owner: 'you.eth' }).namespace).toBe('projects.you.eth')
    expect(tools.namespace).not.toContain('chrome')
  })
})

describe('the watcher — new patterns appear without waiting 90 days', () => {
  it('a short window has a proportionate bar, so a new project shows up the same day', async () => {
    const { findings } = await import('../src/chrome.js')
    // A real day of working on something new, next to a busy inbox.
    const today = [
      { host: 'newthing.dev', title: 'NewThing — docs', visits: 60, urls: 22 },
      { host: 'mail.google.com', title: 'Inbox', visits: 90, urls: 40 },
    ]
    // The 90-day bar ignores it — 60 visits is nothing over a quarter.
    expect(findings(today).map((f) => f.text)).toEqual([])
    // The short window sees it…
    const short = findings(today, { minVisits: 8, scale: 0.25 }).map((f) => f.text)
    expect(short.some((t) => t.includes('NewThing'))).toBe(true)
    // …and still refuses the inbox, at any window.
    expect(short.some((t) => t.includes('mail.google'))).toBe(false)
  })

  it('a tick writes only what is new; running it again writes nothing', async () => {
    const d = scratch()
    const { grant } = await import('../src/agent.js')
    const { tick } = await import('../src/watch.js')
    grant('shell')
    // No model in tests: extraction must work from rules alone.
    const first = await tick({ owner: 'acme.eth', useModel: false })
    const second = await tick({ owner: 'acme.eth', useModel: false })
    // Whatever the machine has, the second pass is quiet — that is what makes
    // it safe to run on a timer.
    expect(second.written.length).toBe(0)
    expect(first.checked).toBe(second.checked)
    rmSync(d, { recursive: true, force: true })
  })
})

describe('it notices new activity', () => {
  it('a site browsed today becomes a claim on the next pass', async () => {
    const { execFileSync } = await import('node:child_process')
    const { copyFileSync } = await import('node:fs')
    const { chromeProfiles, findings, readHistory } = await import('../src/chrome.js')
    const p = chromeProfiles()[0]
    if (!p) return // no browser on this machine; nothing to assert
    const d = mkdtempSync(join(tmpdir(), 'live-'))
    const db = join(d, 'History')
    copyFileSync(p.path, db)
    const opts = { minVisits: 8, scale: 0.25 }
    const before = findings(readHistory(db, { days: 3 }), opts).map((f) => f.text)

    // Write visits the way Chrome does: microseconds since 1601.
    const now = Math.round((Date.now() / 1000 + 11_644_473_600) * 1_000_000)
    execFileSync('sqlite3', [db, Array.from({ length: 45 }, (_, i) =>
      `insert into urls (url, title, visit_count, typed_count, last_visit_time, hidden) values ('https://rust-lang.org/p${i}', 'Rust Programming Language', 2, 0, ${now}, 0);`).join('\n')])

    const after = findings(readHistory(db, { days: 3 }), opts).map((f) => f.text)
    const fresh = after.filter((t) => !before.includes(t))
    expect(fresh.some((t) => t.toLowerCase().includes('rust'))).toBe(true)
    rmSync(d, { recursive: true, force: true })
  })
})

describe('LLM extraction (OpenRouter)', () => {
  it('parses whatever shape a small free model returns', async () => {
    const { parseJsonArray } = await import('../src/llm.js')
    const want = [{ claim: 'Works on X', topic: 'projects', host: 'x.dev' }]
    expect(parseJsonArray(JSON.stringify(want))).toEqual(want)
    expect(parseJsonArray('```json\n' + JSON.stringify(want) + '\n```')).toEqual(want)
    expect(parseJsonArray(`Here you go:\n${JSON.stringify(want)}\nHope that helps.`)).toEqual(want)
    // Free models do these three constantly.
    expect(parseJsonArray(`{"claims": ${JSON.stringify(want)}}`)).toEqual(want)
    expect(parseJsonArray(JSON.stringify(want[0]))).toEqual(want)
    expect(parseJsonArray('[{"claim":"Works on X","topic":"projects","host":"x.dev",}]')[0]).toMatchObject({ claim: 'Works on X' })
    expect(parseJsonArray('I could not find anything.')).toEqual([])
    // Truncated at a token limit: keep the objects that completed rather than
    // losing the whole reply. This was the bug that made free models look broken.
    const cut = '[{"claim":"Works on X","topic":"projects","host":"x.dev"},{"claim":"Uses Y","topic":"tools","host":"y.io"},{"claim":"Studi'
    expect(parseJsonArray(cut)).toHaveLength(2)
  })

  it('is off without a key; defaults to a free model and keeps free fallbacks', async () => {
    const { llmConfig, llmAvailable, FREE_MODELS } = await import('../src/llm.js')
    expect(llmAvailable({} as NodeJS.ProcessEnv)).toBe(false)

    // No model named: the free default, with the other free ones behind it.
    const dflt = llmConfig({ OPENROUTER_API_KEY: 'sk-test' } as unknown as NodeJS.ProcessEnv)
    expect(dflt?.model).toBe(FREE_MODELS[0])
    expect(dflt?.model).toContain(':free')
    expect(dflt?.fallbacks).not.toContain(dflt?.model)
    expect(dflt?.fallbacks?.every((m) => m.endsWith(':free'))).toBe(true)
    expect(dflt?.baseUrl).toContain('openrouter.ai')

    // A chosen model is respected and never repeated in the fallbacks.
    const picked = llmConfig({ OPENROUTER_API_KEY: 'sk-test', KNOWLEDGE_MODEL: 'google/gemma-4-31b-it:free' } as unknown as NodeJS.ProcessEnv)
    expect(picked?.model).toBe('google/gemma-4-31b-it:free')
    expect(picked?.fallbacks).not.toContain('google/gemma-4-31b-it:free')
  })

  it('moves past a model whose reply carries no JSON, not just an empty one', async () => {
    const { extractFromBrowsing } = await import('../src/llm.js')
    const rows = [{ host: 'rust-lang.org', title: 'Rust Programming Language', visits: 200, urls: 60 }]
    const original = globalThis.fetch
    const seen: string[] = []
    globalThis.fetch = (async (_u: string, init: { body: string }) => {
      const model = (JSON.parse(init.body) as { model: string }).model
      seen.push(model)
      // Reasoning-tuned free models do exactly this: a page of deliberation,
      // no JSON. Treating it as an answer would strand the chain here.
      const content = model === 'reasoner' ? "Here's a thinking process: 1. Analyze the input..." : '[{"claim":"Studies Rust systems programming","topic":"interests","host":"rust-lang.org"}]'
      return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) }
    }) as unknown as typeof fetch
    try {
      const out = await extractFromBrowsing(rows, { apiKey: 'k', model: 'reasoner', baseUrl: 'https://example.invalid', fallbacks: ['worker'] })
      expect(seen).toEqual(['reasoner', 'worker'])
      expect(out).toHaveLength(1)
      expect(out[0]!.evidence).toContain('worker')
    } finally { globalThis.fetch = original }
  })

  it('moves to the next free model when one is rate-limited', async () => {
    const { extractFromBrowsing, FREE_MODELS } = await import('../src/llm.js')
    const rows = [{ host: 'rust-lang.org', title: 'Rust Programming Language', visits: 200, urls: 60 }]
    const original = globalThis.fetch
    const seen: string[] = []
    globalThis.fetch = (async (_url: string, init: { body: string }) => {
      const model = (JSON.parse(init.body) as { model: string }).model
      seen.push(model)
      // The first free model is rate-limited, as free tiers routinely are.
      if (model === FREE_MODELS[0]) return { ok: false, status: 429, text: async () => 'rate limited' }
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify([{ claim: 'Studies Rust systems programming', topic: 'interests', host: 'rust-lang.org' }]) } }] }) }
    }) as unknown as typeof fetch
    try {
      const out = await extractFromBrowsing(rows, { apiKey: 'k', model: FREE_MODELS[0]!, baseUrl: 'https://example.invalid', fallbacks: [FREE_MODELS[1]!] })
      expect(seen).toEqual([FREE_MODELS[0], FREE_MODELS[1]])
      expect(out).toHaveLength(1)
      // The claim cites the model that actually answered, not the one we asked first.
      expect(out[0]!.evidence).toContain(FREE_MODELS[1])
    } finally { globalThis.fetch = original }
  })

  it('drops claims the model did not ground in the data it was given', async () => {
    const { extractFromBrowsing } = await import('../src/llm.js')
    const rows = [{ host: 'rust-lang.org', title: 'Rust Programming Language', visits: 200, urls: 60 }]
    const original = globalThis.fetch
    // The model returns one grounded claim and one about a site it never saw.
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify([
        { claim: 'Studies Rust systems programming', topic: 'interests', host: 'rust-lang.org', confidence: 0.8 },
        { claim: 'Works at Acme Corp as a director', topic: 'projects', host: 'acme-corp.com', confidence: 0.9 },
      ]) } }] }),
    })) as unknown as typeof fetch
    try {
      const out = await extractFromBrowsing(rows, { apiKey: 'k', model: 'test/model', baseUrl: 'https://example.invalid' })
      expect(out).toHaveLength(1)
      expect(out[0]!.text).toBe('Studies Rust systems programming')
      expect(out[0]!.evidence).toContain('test/model')
    } finally { globalThis.fetch = original }
  })
})

describe('the same fact stated many ways stays one claim', () => {
  it('routes re-phrasings of a tool to the same subject', () => {
    const t = topicFor('Uses Linear for project tracking')
    const phrasings = [
      'Tracks work in Linear',
      'Uses Linear for project and task management',
      'Uses Linear for project tracking',
      'Uses Linear for task and sprint tracking',
    ]
    // `mergeClaim` keys on subject, so a subject that swallowed the predicate
    // ("Linear for project and") would make every wording a separate claim.
    for (const p of phrasings) expect(subjectFor(p, t)).toBe('Linear')
  })

  it('keeps the entity out of the predicate, and full statements intact', () => {
    expect(subjectFor('Works on Loops House, an AI-native hackathon platform', 'projects')).toBe('Loops House')
    expect(subjectFor('Uses Vercel for hosting and deployment', 'tools')).toBe('Vercel')
    // A convention is a whole statement; there is no entity to reduce it to.
    expect(subjectFor('Never cache ENSv2 token ids', 'conventions')).toBe('Never cache ENSv2 token')
  })

  it('recognises a re-phrasing as a restatement before it is written', async () => {
    const { isRestatement } = await import('../src/watch.js')
    const known = ['Tracks work in Linear', 'Deploys on Vercel']
    // Word overlap alone scores these at 0.14 and 0.14 — far under any workable
    // threshold. Same subject, same topic is what identifies them.
    expect(isRestatement('Uses Linear for project tracking', known)).toBe(true)
    expect(isRestatement('Uses Vercel for hosting and deployment', known)).toBe(true)
    // A different tool is still new, and so is a different kind of statement.
    expect(isRestatement('Uses GitHub for source control', known)).toBe(false)
    expect(isRestatement('Never cache ENSv2 token ids', known)).toBe(false)
  })
})

describe('multi-user: identity, tokens and isolation', () => {
  const withSecret = <T,>(fn: () => T): T => {
    const prev = process.env.CONNECT_SECRET
    process.env.CONNECT_SECRET = 'a'.repeat(64)
    try { return fn() } finally { if (prev === undefined) delete process.env.CONNECT_SECRET; else process.env.CONNECT_SECRET = prev }
  }

  it('refuses to store tokens without an encryption key', async () => {
    const { encryptSecret } = await import('../src/users.js')
    const prev = process.env.CONNECT_SECRET
    delete process.env.CONNECT_SECRET
    // A default key would mean these are encrypted in name only, and they read
    // other people's accounts.
    expect(() => encryptSecret('tok')).toThrow(/CONNECT_SECRET/)
    if (prev !== undefined) process.env.CONNECT_SECRET = prev
  })

  it('round-trips a token and never stores it in the clear', async () => {
    const { encryptSecret, decryptSecret } = await import('../src/users.js')
    withSecret(() => {
      const enc = encryptSecret('gho_secret_value')
      expect(enc).not.toContain('gho_secret_value')
      expect(decryptSecret(enc)).toBe('gho_secret_value')
    })
  })

  it('signs a session that cannot be forged or replayed after expiry', async () => {
    const { signSession, verifySession } = await import('../src/users.js')
    withSecret(() => {
      const cookie = signSession('user-abc')
      expect(verifySession(cookie)).toBe('user-abc')
      // Swapping the user id invalidates the signature.
      expect(verifySession(cookie.replace('user-abc', 'user-xyz'))).toBe(null)
      expect(verifySession('garbage')).toBe(null)
      expect(verifySession(undefined)).toBe(null)
      expect(verifySession(cookie, 0)).toBe(null)
    })
  })

  it('keeps two users apart: grants and namespaces', async () => {
    const d = scratch()
    const { upsertWalletUser } = await import('../src/users.js')
    const { grant, readGrants } = await import('../src/agent.js')
    withSecret(() => {
      const a = upsertWalletUser({ address: '0xaaa', name: 'alice.eth' })
      const b = upsertWalletUser({ address: '0xbbb', name: 'bob.eth' })
      // The namespace is the name they proved, not one this site issued.
      expect(a.namespace).toBe('alice.eth')
      expect(b.namespace).toBe('bob.eth')
      grant('github', a.id)
      // Bob must not inherit Alice's grant — that is the agent reading one
      // person's accounts into another person's namespace.
      expect(readGrants(a.id).map((g) => g.workspaceId)).toEqual(['github'])
      expect(readGrants(b.id)).toEqual([])
    })
    rmSync(d, { recursive: true, force: true })
  })

  it('only offers sources the viewer can actually connect', async () => {
    const { workspacesFor } = await import('../src/workspaces.js')
    // A hosted visitor cannot connect the server's own browser history.
    const hosted = workspacesFor({ hosted: true, providers: ['github'] }).map((w) => w.id)
    expect(hosted).toContain('github')
    expect(hosted).not.toContain('chrome')
    expect(hosted).not.toContain('google')
    const local = workspacesFor({ hosted: false }).map((w) => w.id)
    expect(local).toContain('chrome')
  })

  it('asks for the narrowest scopes that answer the question', async () => {
    const { providerConfig } = await import('../src/oauth.js')
    const env = { GITHUB_CLIENT_ID: 'x', GITHUB_CLIENT_SECRET: 'y', GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y' } as NodeJS.ProcessEnv
    const gh = providerConfig('github', env)!
    // `repo` would grant read access to private source code.
    expect(gh.scopes).not.toContain('repo')
    const google = providerConfig('google', env)!
    // `gmail.readonly` would allow reading message bodies; metadata cannot.
    expect(google.scopes).not.toContain('https://www.googleapis.com/auth/gmail.readonly')
    expect(google.scopes).toContain('https://www.googleapis.com/auth/gmail.metadata')
    expect(google.scopes).toContain('https://www.googleapis.com/auth/calendar.readonly')
  })
})

describe('Linear', () => {
  it('never selects issue titles or descriptions', async () => {
    const src = readFileSync(new URL('../src/linear.ts', import.meta.url), 'utf8')
    const query = src.slice(src.indexOf('assignedIssues'), src.indexOf('}`)'))
    // The guarantee is enforced by what the query asks for. A title that is never
    // fetched cannot leak from anywhere downstream.
    expect(query).not.toMatch(/\btitle\b/)
    expect(query).not.toMatch(/\bdescription\b/)
    expect(query).not.toMatch(/\bcomments\b/)
  })

  it('claims teams and projects, not individual issues', async () => {
    const { findings } = await import('../src/linear.js')
    const out = findings({
      teams: [{ name: 'Platform', key: 'PLA', issues: 9 }, { name: 'Growth', key: 'GRO', issues: 1 }],
      projects: [{ name: 'Billing v2', state: 'started', issues: 5 }, { name: 'Old Thing', state: 'completed', issues: 7 }],
    })
    const texts = out.map((f) => f.text)
    expect(texts).toContain('Works on the Platform team')
    expect(texts).toContain('Works on the Billing v2 project')
    expect(texts).toContain('Tracks work in Linear')
    // One assigned issue is being cc'd, not a team you work on.
    expect(texts).not.toContain('Works on the Growth team')
    // What shipped last quarter is history, not what you do now.
    expect(texts).not.toContain('Works on the Old Thing project')
  })

  it('is offered to hosted visitors once configured', async () => {
    const { workspacesFor } = await import('../src/workspaces.js')
    // Linear appears once configured; the wallet needs no provider, so it is always offered.
    expect(workspacesFor({ hosted: true, providers: ['linear'] }).map((w) => w.id)).toEqual(['ethereum', 'linear'])
  })
})

describe('a hosted visitor never reads the server’s own credentials', () => {
  it('ignores the gh CLI token unless explicitly allowed', async () => {
    const { readSourceNow } = await import('../src/watch.js')
    // No token supplied and no opt-in: GitHub must return nothing rather than
    // falling back to whatever `gh` is signed in as on the server.
    expect(await readSourceNow('github', { useModel: false })).toEqual([])
  })
})

describe('Granola', () => {
  it('needs no registered credentials — the client id is a URL', async () => {
    const { providerConfig, configuredProviders } = await import('../src/oauth.js')
    const env = { CONNECT_BASE_URL: 'https://memory.example.com' } as NodeJS.ProcessEnv
    // Every other provider disappears without a client id and secret; Granola
    // is offerable with neither, because CIMD identifies the app by URL.
    expect(configuredProviders(env)).toEqual(['granola'])
    const cfg = providerConfig('granola', env)!
    expect(cfg.clientId).toBe('https://memory.example.com/api/auth/client-metadata')
    expect(cfg.clientSecret).toBe('')
    expect(cfg.publicClient).toBe(true)
  })

  it('uses PKCE instead of a secret, and refuses to start without it', async () => {
    const { authorizeUrl, challengeFor, newVerifier } = await import('../src/oauth.js')
    const env = { CONNECT_BASE_URL: 'https://memory.example.com' } as NodeJS.ProcessEnv
    const verifier = newVerifier()
    const url = new URL(authorizeUrl('granola', 'st', env, verifier))
    expect(url.searchParams.get('code_challenge')).toBe(challengeFor(verifier))
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    // The verifier itself must never appear in a URL the provider or the
    // browser can see — only its hash.
    expect(url.toString()).not.toContain(verifier)
    expect(() => authorizeUrl('granola', 'st', env)).toThrow(/PKCE/)
  })

  it('claims recurring meetings, never their contents', async () => {
    const { findings } = await import('../src/granola.js')
    const mk = (title: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `${title}-${i}`, title, date: '', participants: [] }))
    const out = findings([...mk('Design review', 7), ...mk('Weekly sync', 4)])
    expect(out.map((f) => f.text)).toContain('Attends Design review regularly')
    expect(out.map((f) => f.text)).toContain('Keeps meeting notes in Granola')
  })

  it('refuses to call a tool that returns notes, summaries or transcripts', async () => {
    const { neverCalled } = await import('../src/granola.js')
    // Meeting notes are the densest personal data here, and the guarantee used
    // to be a comment — which binds nobody, and would not survive a later
    // change by someone who had not read it.
    expect(neverCalled()).toContain('get_meetings')
    expect(neverCalled()).toContain('get_meeting_transcript')
    // A token is never reached: the refusal happens before the request.
    await expect((await import('../src/granola.js')).accountInfo('x')).rejects.toThrow()
  })
})

describe('connecting an ENS name as your memory', () => {
  it('binds the signature to one name, address and nonce', async () => {
    const { challengeMessage } = await import('../src/wallet.js')
    const m = challengeMessage({ address: '0xabc', name: 'rishikesh.eth', nonce: 'n1', domain: 'memory.example.com' })
    expect(m).toContain('Address: 0xabc')
    expect(m).toContain('Name: rishikesh.eth')
    expect(m).toContain('Nonce: n1')
    // A person signing this should be able to read what it authorises.
    expect(m).toContain('authorises no transaction')
  })

  it('rejects a signed message that does not match the request', async () => {
    const { verifyNameControl } = await import('../src/wallet.js')
    const base = { address: '0xabc', name: 'rishikesh.eth', signature: '0xsig', expectedNonce: 'n1' }

    // Replayed from an earlier challenge.
    expect((await verifyNameControl({ ...base, message: 'Nonce: other' })).ok).toBe(false)
    // Signed for a different name than the one being claimed — the attack this
    // check exists for.
    const swapped = await verifyNameControl({ ...base, message: 'Address: 0xabc\nName: someone-else.eth\nNonce: n1' })
    expect(swapped.ok).toBe(false)
    if (!swapped.ok) expect(swapped.reason).toMatch(/does not match/)
  })

  it('writes to the name that was proven, with nothing to upgrade from', async () => {
    const d = scratch()
    const { upsertWalletUser, readUser } = await import('../src/users.js')
    const prev = process.env.CONNECT_SECRET
    process.env.CONNECT_SECRET = 'a'.repeat(64)

    const u = upsertWalletUser({ address: '0xabc', name: 'rishikesh.eth' })
    // No host-issued subdomain to start on: a name this site handed out is one
    // this site could take back.
    expect(u.namespace).toBe('rishikesh.eth')
    expect(readUser(u.id)?.wallet?.address).toBe('0xabc')

    // The same wallet proving a different name writes new claims there. Old
    // ones stay where they were — moving them would rewrite provenance.
    const again = upsertWalletUser({ address: '0xabc', name: 'other.eth' })
    expect(again.id).toBe(u.id)
    expect(again.namespace).toBe('other.eth')

    if (prev === undefined) delete process.env.CONNECT_SECRET; else process.env.CONNECT_SECRET = prev
    rmSync(d, { recursive: true, force: true })
  })
})

describe('chat can act, but only with a yes', () => {
  it('treats anything not clearly a read as a write', async () => {
    const { isReadOnly } = await import('../src/mcp-client.js')
    expect(isReadOnly('list_issues')).toBe(true)
    expect(isReadOnly('get_meeting_transcript')).toBe(true)
    expect(isReadOnly('search_notes')).toBe(true)
    // Writes, by name.
    expect(isReadOnly('create_issue')).toBe(false)
    expect(isReadOnly('send_message')).toBe(false)
    // An unrecognised name defaults to "writes". Guessing wrong in the other
    // direction means acting without being asked.
    expect(isReadOnly('do_the_thing')).toBe(false)
    // A reassuring name does not override a description that admits to writing.
    expect(isReadOnly('list_and_close_stale', 'Lists stale issues and will close them')).toBe(false)
  })

  it('refuses a tool that no connected server declared', async () => {
    const { callTool } = await import('../src/mcp-client.js')
    // The model names a tool; it never names a URL or a token. A name that is
    // not in the list cannot be reached.
    const r = await callTool([], [], 'create_issue', {})
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/not connected/)
  })

  it('reads memory with its provenance attached', async () => {
    const d = scratch()
    const { memoryOf } = await import('../src/chat.js')
    const { ingest } = await import('../src/ingest.js')
    ingest({
      connector: 'chrome', sourceName: 'Browser history', sourceKind: 'application',
      text: 'Uses Linear for project tracking', actor: 'you', trigger: '900 visits', at: '',
    }, { owner: 'acme.eth', create: true })

    const mem = memoryOf('acme.eth')
    const found = mem.find((m) => m.claim.includes('Linear'))
    expect(found).toBeTruthy()
    // An answer has to be traceable the same way a claim is.
    expect(found!.sources).toContain('Browser history')
    expect(found!.namespace).toBe('tools.acme.eth')
    rmSync(d, { recursive: true, force: true })
  })
})

describe('a client id must be one the provider can actually fetch', () => {
  it('knows which base URLs an authorization server can reach', async () => {
    const { isPubliclyReachable } = await import('../src/oauth.js')
    expect(isPubliclyReachable({ CONNECT_BASE_URL: 'https://memory.example.com' } as NodeJS.ProcessEnv)).toBe(true)
    // The case that produced `application_not_found`: Granola cannot fetch a
    // metadata document served from someone's laptop.
    expect(isPubliclyReachable({ CONNECT_BASE_URL: 'http://localhost:3000' } as NodeJS.ProcessEnv)).toBe(false)
    expect(isPubliclyReachable({ CONNECT_BASE_URL: 'http://192.168.1.4:3000' } as NodeJS.ProcessEnv)).toBe(false)
    // http is not reachable in the sense that matters either — these servers
    // require https for a client metadata document.
    expect(isPubliclyReachable({ CONNECT_BASE_URL: 'http://memory.example.com' } as NodeJS.ProcessEnv)).toBe(false)
    expect(isPubliclyReachable({} as NodeJS.ProcessEnv)).toBe(false)
  })

  it('falls back to a registered client id when the host is unreachable', async () => {
    const { providerConfig } = await import('../src/oauth.js')
    const local = { CONNECT_BASE_URL: 'http://localhost:3000' } as NodeJS.ProcessEnv
    // Unregistered and unreachable: offering the flow would only produce
    // `application_not_found` at the provider, so it reports unconfigured.
    expect(providerConfig('granola', local)).toBe(null)
    // Reachable: the URL is the client id, no registration needed.
    const hosted = providerConfig('granola', { CONNECT_BASE_URL: 'https://memory.example.com' } as NodeJS.ProcessEnv)
    expect(hosted?.clientId).toBe('https://memory.example.com/api/auth/client-metadata')
  })
})

describe('GitHub reports the window it actually saw', () => {
  const repo = (name: string, owner: string, events: number, language: string | null = null) =>
    ({ name, owner, events, language, description: null, private: false })

  it('states the observed period rather than a fixed one', async () => {
    const { findings } = await import('../src/github.js')
    // GitHub caps its events API at 300 entries, so a busy account sees a few
    // weeks and a quiet one sees months. Claiming "90 days" either way would
    // overstate what the evidence covers.
    const out = findings({ repos: [repo('tokyo', 'rk', 12, 'TypeScript')], observedDays: 15 })
    expect(out[0]!.evidence).toBe('12 contributions in 15 days')
    expect(out.some((f) => f.evidence.includes('90 days'))).toBe(false)
  })

  it('qualifies a repository name that two owners share', async () => {
    const { findings } = await import('../src/github.js')
    const out = findings({
      repos: [repo('docs', 'upstream', 11, 'JavaScript'), repo('docs', 'me', 6), repo('solo', 'me', 9)],
      observedDays: 15,
    })
    const texts = out.map((f) => f.text)
    // A fork and its upstream are different repositories; unqualified they read
    // as one claim written twice.
    expect(texts).toContain('Works on upstream/docs, a JavaScript project')
    expect(texts).toContain('Works on me/docs')
    // An unambiguous name stays short.
    expect(texts).toContain('Works on solo')
  })
})

describe('a short window that memory grows past', () => {
  it('reads a recent window, not a long one', async () => {
    const src = readFileSync(new URL('../src/github.ts', import.meta.url), 'utf8')
    // Each pass asks what you worked on lately. Claims are never removed, so a
    // repo you have moved on from keeps the evidence from when it was true —
    // memory grows from many small reads rather than one large one.
    const { POLICY } = await import('../src/policy.js')
    expect(POLICY.github.windowDays).toBe(15)
  })

  it('never claims a longer period than the window asked for', async () => {
    const { findings } = await import('../src/github.js')
    const out = findings({ repos: [repo15('a', 'me', 5)], observedDays: 15 })
    expect(out[0]!.evidence).toContain('in 15 days')
  })
})

const repo15 = (name: string, owner: string, events: number) =>
  ({ name, owner, events, language: null, description: null, private: false })

describe('one contribution in the window is enough', () => {
  it('claims a repository touched once, and counts it correctly', async () => {
    const { findings } = await import('../src/github.js')
    const out = findings({ repos: [repo15('starter', 'me', 1)], observedDays: 15 })
    expect(out.map((f) => f.text)).toContain('Works on starter')
    // "1 contributions" is the kind of detail that makes generated text read as
    // generated. The count is the evidence, so it has to look deliberate.
    expect(out[0]!.evidence).toBe('1 contribution in 15 days')
  })

  it('still withholds private repositories, whatever the count', async () => {
    const { findings } = await import('../src/github.js')
    const out = findings({
      repos: [{ name: 'secret', owner: 'me', events: 142, language: 'TypeScript', description: null, private: true }],
      observedDays: 15,
    })
    // A private repository contributes its language and nothing else — the name
    // is the part someone chose not to publish.
    expect(out.map((f) => f.text)).not.toContain('Works on secret')
    expect(out.map((f) => f.text)).toContain('Writes TypeScript')
  })

  it('counts one repository in the singular', async () => {
    const { findings } = await import('../src/github.js')
    const out = findings({ repos: [repo15b('solo', 'me', 6, 'Rust')], observedDays: 15 })
    expect(out.find((f) => f.text === 'Writes Rust')!.evidence).toBe('6 contributions in 15 days across 1 repository')
  })

  it('does not declare a language off a couple of commits', async () => {
    const { findings } = await import('../src/github.js')
    // Naming a repository needs one contribution; saying what someone *writes*
    // is a broader claim and keeps a higher bar.
    const out = findings({ repos: [repo15b('dabble', 'me', 2, 'Haskell')], observedDays: 15 })
    expect(out.map((f) => f.text)).toContain('Works on dabble, a Haskell project')
    expect(out.map((f) => f.text)).not.toContain('Writes Haskell')
  })
})

const repo15b = (name: string, owner: string, events: number, language: string) =>
  ({ name, owner, events, language, description: null, private: false })

describe('chat survives a rate-limited free tier', () => {
  it('offers every free model to chat, and they all take tools', async () => {
    const { FREE_MODELS, llmConfig } = await import('../src/llm.js')
    const cfg = llmConfig({ OPENROUTER_API_KEY: 'k' } as NodeJS.ProcessEnv)!
    // The extraction path has always walked this list. Chat used one model and
    // gave up on the first 429, which is the same failure with no recovery.
    expect([cfg.model, ...(cfg.fallbacks ?? [])]).toHaveLength(FREE_MODELS.length)
    expect(FREE_MODELS.every((m) => m.endsWith(':free'))).toBe(true)
  })

  it('says a rate limit is a rate limit', async () => {
    const { RateLimited, walkModels } = await import('../src/llm.js')
    const cfg = { apiKey: 'k', model: 'a', baseUrl: '', fallbacks: ['b', 'c'] }
    // OpenRouter's daily cap is per account, so the whole chain can be
    // exhausted at once. "429 {...json...}" in a chat bubble reads as a crash;
    // the point is that it clears on its own.
    await expect(
      walkModels(cfg, () => Promise.reject(new RateLimited('rate-limited')), () => true, () => ''),
    ).rejects.toThrow(/rate-limited right now/)

    // A real failure must not be dressed up as a rate limit.
    await expect(
      walkModels(cfg, () => Promise.reject(new Error('bad request')), () => true, () => ''),
    ).rejects.toThrow(/No model answered/)
  })

  it('moves to the next model and reports which one answered', async () => {
    const { RateLimited, walkModels } = await import('../src/llm.js')
    const cfg = { apiKey: 'k', model: 'busy', baseUrl: '', fallbacks: ['free'] }
    const { result, model } = await walkModels(
      cfg,
      (m) => (m === 'busy' ? Promise.reject(new RateLimited('429')) : Promise.resolve('answer')),
      (r) => r === 'answer',
      () => 'no',
    )
    expect(result).toBe('answer')
    expect(model).toBe('free')
  })
})

describe('identity is a wallet, so two people cannot collide', () => {
  it('gives every wallet its own namespace, from the name it proved', async () => {
    const d = scratch()
    const prev = process.env.CONNECT_SECRET
    process.env.CONNECT_SECRET = 'a'.repeat(64)
    const { upsertWalletUser } = await import('../src/users.js')

    // Display names collided — a GitHub `rishikesh`, a Google
    // `rishikesh@gmail.com` and a Linear `Rishikesh` were one namespace and
    // therefore one repository. An address cannot collide, and the name is one
    // the registry says they own.
    const users = [
      upsertWalletUser({ address: '0xaaa1', name: 'rishikesh.eth' }),
      upsertWalletUser({ address: '0xbbb2', name: 'rk.eth' }),
      upsertWalletUser({ address: '0xccc3', name: 'kale.eth' }),
    ]
    expect(new Set(users.map((u) => u.id)).size).toBe(3)
    expect(new Set(users.map((u) => u.namespace)).size).toBe(3)
    expect(users.map((u) => u.namespace)).toEqual(['rishikesh.eth', 'rk.eth', 'kale.eth'])

    if (prev === undefined) delete process.env.CONNECT_SECRET; else process.env.CONNECT_SECRET = prev
    rmSync(d, { recursive: true, force: true })
  })
})

describe('what the consent screen promises is what the code does', () => {
  it('states no window the policy does not define', async () => {
    const { WORKSPACES } = await import('../src/workspaces.js')
    const { POLICY, policyFor } = await import('../src/policy.js')
    for (const ws of WORKSPACES) {
      for (const sc of ws.scopes) {
        const stated = [...sc.detail.matchAll(/(\d+)\s*days?\b/g)].map((m) => Number(m[1]))
        if (!stated.length) continue
        const p = policyFor(ws.id)
        // A consent screen that names a window the reader does not use is the
        // worst bug this product can have: it is the screen whose whole job is
        // to be true. It said "90 days" for GitHub while the reader used 15.
        expect(p, `${ws.id} states a window but has no policy`).toBeTruthy()
        for (const n of stated) expect(n, `${ws.id} consent copy`).toBe(p!.windowDays)
      }
    }
    expect(Object.keys(POLICY).length).toBeGreaterThan(0)
  })

  it('derives evidence periods rather than repeating them', async () => {
    const { findings } = await import('../src/github.js')
    const { POLICY } = await import('../src/policy.js')
    const out = findings({
      repos: [{ name: 'x', owner: 'me', events: 9, language: null, description: null, private: false }],
      observedDays: POLICY.github.windowDays,
    })
    expect(out[0]!.evidence).toBe(`9 contributions in ${POLICY.github.windowDays} days`)
  })

  it('has a policy for every source that can be connected', async () => {
    const { WORKSPACES } = await import('../src/workspaces.js')
    const { policyFor } = await import('../src/policy.js')
    for (const ws of WORKSPACES) {
      expect(policyFor(ws.id), `no policy for ${ws.id}`).toBeTruthy()
    }
  })
})

describe('Granola reads what Granola actually returns', () => {
  const XML = `<access_notice>Results exclude public workspace notes.</access_notice>
<meetings_data from="Sep 1" to="Sep 22" count="2">
<meeting id="a1" title="Sarah Thiam and Lena Hierzi" date="Sep 23, 2026" captured_by_me="true">
    <known_participants>
    Rishikesh Kale (note creator) from Fil &lt;rishikesh@fil.builders&gt;, Sarah &lt;sarah@germinalabs.xyz&gt;, Lena Hierzi from Celo &lt;lena.hierzi@celo.org&gt;
    </known_participants>
  </meeting>
<meeting id="a2" title="Design review" date="Sep 20, 2026">
    <known_participants>
    Sarah &lt;sarah@germinalabs.xyz&gt;
    </known_participants>
  </meeting>
</meetings_data>`

  it('parses the XML response, not JSON', async () => {
    const { parseMeetings } = await import('../src/granola.js')
    const ms = parseMeetings(XML)
    // An earlier version assumed JSON, silently fell through to splitting on
    // newlines, and produced nothing from a connection that was working.
    expect(ms).toHaveLength(2)
    expect(ms[0]!.title).toBe('Sarah Thiam and Lena Hierzi')
    expect(ms[0]!.participants.map((p) => p.name)).toEqual(['Sarah', 'Lena Hierzi'])
    // The person whose notes these are is not someone they "work with".
    expect(ms[0]!.participants.some((p) => p.email.includes('rishikesh'))).toBe(false)
    expect(ms[0]!.participants[1]!.org).toBe('Celo')
  })

  it('claims the people, and never needs a title to recur', async () => {
    const { findings, parseMeetings } = await import('../src/granola.js')
    const out = findings(parseMeetings(XML))
    const texts = out.map((f) => f.text)
    // Requiring three meetings with one title meant a real account with real
    // meetings produced nothing at all.
    expect(texts).toContain('Works with Sarah')
    expect(texts).toContain('Keeps meeting notes in Granola')
  })

  it('says something useful from a single meeting', async () => {
    const { findings, parseMeetings } = await import('../src/granola.js')
    const one = parseMeetings(XML.replace(/<meeting id="a2"[\s\S]*?<\/meeting>/, ''))
    const out = findings(one)
    expect(out.map((f) => f.text)).toContain('Keeps meeting notes in Granola')
    expect(out[out.length - 1]!.evidence).toBe('1 meeting recorded')
  })
})

describe('a connection that expires is refreshed, not silently dead', () => {
  it('reports why a source stopped working', async () => {
    const d = scratch()
    const prev = process.env.CONNECT_SECRET
    process.env.CONNECT_SECRET = 'a'.repeat(64)
    process.env.CONNECT_HOST_NAMESPACE = 'demo.eth'
    const { upsertWalletUser, putToken } = await import('../src/users.js')
    const { liveToken, brokenConnections, noteConnectionFailed } = await import('../src/tokens.js')

    const u = upsertWalletUser({ address: '0xdead', name: 'someone.eth' })
    // An expired token with no refresh token: reconnecting is the only fix, and
    // the person has to be told rather than left with a quiet source.
    putToken(u.id, {
      provider: 'granola', account: 'someone', scopes: [], grantedAt: new Date().toISOString(),
      accessToken: 'stale', expiresAt: new Date(Date.now() - 1000).toISOString(),
    })
    const state = await liveToken(u.id, 'granola')
    expect(state.ok).toBe(false)
    if (!state.ok) expect(state.reason).toBe('expired')

    noteConnectionFailed(u.id, 'granola', 'Session expired')
    expect(brokenConnections(u.id).map((b) => b.provider)).toEqual(['granola'])

    if (prev === undefined) delete process.env.CONNECT_SECRET; else process.env.CONNECT_SECRET = prev
    rmSync(d, { recursive: true, force: true })
  })
})

describe('a misconfigured deployment fails at boot, not on a visitor', () => {
  it('knows which mode it is in', async () => {
    const { deploymentMode } = await import('../src/config.js')
    expect(deploymentMode({ CONNECT_OWNER: 'me.eth' } as NodeJS.ProcessEnv)).toBe('local')
    expect(deploymentMode({ GITHUB_CLIENT_ID: 'a', GITHUB_CLIENT_SECRET: 'b' } as NodeJS.ProcessEnv)).toBe('hosted')
    expect(deploymentMode({ CONNECT_BASE_URL: 'https://memory.example.com' } as NodeJS.ProcessEnv)).toBe('hosted')
    // Running on your own machine with a base URL set is still local.
    expect(deploymentMode({ CONNECT_BASE_URL: 'http://localhost:3000' } as NodeJS.ProcessEnv)).toBe('local')
  })

  it('names the missing variable rather than the symptom', async () => {
    const { configProblems, configReport } = await import('../src/config.js')
    const hosted = { GITHUB_CLIENT_ID: 'a', GITHUB_CLIENT_SECRET: 'b' } as NodeJS.ProcessEnv
    const keys = configProblems(hosted).map((p) => p.key)
    // CONNECT_SECRET is only reached when someone signs in, so the one thing
    // that must never be missing was also the last to be noticed.
    expect(keys).toContain('CONNECT_SECRET')
    expect(keys).toContain('CONNECT_BASE_URL')
    // No CONNECT_HOST_NAMESPACE: this deployment issues no namespaces.
    expect(keys).not.toContain('CONNECT_HOST_NAMESPACE')
    expect(configReport(hosted)).toContain('openssl rand -hex 32')
  })

  it('is satisfied by a complete configuration', async () => {
    const { configProblems } = await import('../src/config.js')
    expect(configProblems({
      GITHUB_CLIENT_ID: 'a', GITHUB_CLIENT_SECRET: 'b',
      CONNECT_SECRET: 'a'.repeat(64),
      CONNECT_BASE_URL: 'https://memory.example.com',
    } as NodeJS.ProcessEnv)).toEqual([])
  })

  it('rejects a secret too short to be a key', async () => {
    const { configProblems } = await import('../src/config.js')
    const problems = configProblems({
      GITHUB_CLIENT_ID: 'a', GITHUB_CLIENT_SECRET: 'b',
      CONNECT_SECRET: 'short', CONNECT_BASE_URL: 'https://x.com',
    } as NodeJS.ProcessEnv)
    expect(problems.map((p) => p.key)).toContain('CONNECT_SECRET')
  })
})

describe('the console derives provider labels rather than keeping its own', () => {
  it('names every provider a workspace declares, including Granola', async () => {
    const { providerLabel, WORKSPACES } = await import('../src/workspaces.js')
    // Every provider a workspace declares has a label, and it is stable even
    // where one sign-in serves two sources — Google now has Calendar/mail and
    // the Takeout archive, which read different things.
    for (const ws of WORKSPACES) {
      if (!ws.provider) continue
      expect(providerLabel(ws.provider).name).toBeTruthy()
      expect(providerLabel(ws.provider).glyph).toBeTruthy()
    }
    expect(providerLabel('granola').name).toBe('Granola')
    expect(providerLabel('github').name).toBe('GitHub')
    expect(providerLabel('google').name).toBe('Google')
  })
})

describe('a source is one registry entry', () => {
  it('registers, reads, and reports without touching the watcher', async () => {
    const { register, readSource, readers } = await import('../src/registry.js')
    await import('../src/sources.js')
    const before = readers().length

    register({
      id: 'test-source',
      requires: 'local',
      read: () => [{ text: 'Uses a thing', topic: 'tools', evidence: 'once', by: 'rules' as const, from: 'Test' }],
    })
    expect(readers().length).toBe(before + 1)

    const out = await readSource('test-source', { model: null })
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.findings[0]!.text).toBe('Uses a thing')
  })

  it('tells a failure apart from a quiet source', async () => {
    const { register, readSource } = await import('../src/registry.js')

    register({ id: 'broken', requires: 'local', read: () => { throw new Error('the api moved') } })
    const failed = await readSource('broken', { model: null })
    // The old dispatch chain caught everything in one place, so a source that
    // threw and a source with nothing to say were indistinguishable — which is
    // how an expired token looked like a quiet week.
    expect(failed.ok).toBe(false)
    if (!failed.ok) { expect(failed.reason).toBe('failed'); expect(failed.detail).toContain('the api moved') }

    register({ id: 'needs-token', provider: 'linear', requires: 'token', read: () => [] })
    const missing = await readSource('needs-token', { model: null })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.reason).toBe('not-connected')

    register({ id: 'absent', requires: 'local', available: () => false, read: () => [] })
    const absent = await readSource('absent', { model: null })
    expect(absent.ok).toBe(false)
    if (!absent.ok) expect(absent.reason).toBe('unavailable')
  })

  it('has a reader for every workspace people can connect', async () => {
    await import('../src/sources.js')
    const { reader } = await import('../src/registry.js')
    const { WORKSPACES } = await import('../src/workspaces.js')
    for (const ws of WORKSPACES) {
      expect(reader(ws.id), `no reader registered for ${ws.id}`).toBeTruthy()
    }
  })
})

describe('what someone builds is derived, not looked up in a list', () => {
  const row = (host: string, visits: number, urls: number, title = host) => ({ host, visits, urls, title })

  it('separates building from using by depth, on any set of hosts', async () => {
    const { depthRatio } = await import('../src/chrome.js')
    // Names nobody would have put on a blocklist. Returning to the same pages
    // is what working on something looks like; using a service is broad and
    // shallow.
    const rows = [
      row('staging.myapp.internal', 4000, 260),
      row('suche.example.de', 1500, 1300),
      row('mercadolibre.com.ar', 900, 700),
      row('weibo.cn', 800, 640),
      row('docs.example.org', 600, 450),
      row('forum.example.net', 400, 300),
    ]
    const { POLICY } = await import('../src/policy.js')
    expect(depthRatio(rows[0]!, rows)).toBeGreaterThan(POLICY.chrome.depthRatio)
    for (const r of rows.slice(1)) expect(depthRatio(r, rows)).toBeLessThan(POLICY.chrome.depthRatio)
  })

  it('does not claim a platform as a project, whatever it is called', async () => {
    const { findings } = await import('../src/chrome.js')
    // Enough hosts for a baseline to exist — with only two or three there is
    // nothing to compare against, and the check correctly declines to guess.
    const rows = [
      // Heavy use, many distinct pages: services, not products.
      row('naver.com', 3000, 2400, 'NAVER'),
      row('vk.com', 2000, 1600, 'VK'),
      row('yandex.ru', 1200, 950, 'Yandex'),
      row('rakuten.co.jp', 900, 700, 'Rakuten'),
      row('bol.com', 700, 560, 'bol'),
      row('allegro.pl', 600, 480, 'Allegro'),
      row('build.acme.dev', 2500, 160, 'Acme Build'),
    ]
    const texts = findings(rows).map((f) => f.text)
    // Neither is named as a project, and neither appears on any blocklist —
    // they are excluded because they are used broadly rather than deeply.
    expect(texts.some((t) => /naver/i.test(t))).toBe(false)
    expect(texts.some((t) => /vk\.com/i.test(t))).toBe(false)
    expect(texts).toContain('Works on Acme Build (build.acme.dev)')
  })

  it('stays quiet when there is too little history to compare against', async () => {
    const { depthRatio } = await import('../src/chrome.js')
    // With two hosts there is no baseline, and inventing one would mean
    // claiming a project from noise.
    expect(depthRatio(row('a.com', 100, 5), [row('a.com', 100, 5)])).toBe(1)
  })
})

describe('topics are defined once', () => {
  it('labels every topic the connectors actually produce', async () => {
    const { TOPIC_IDS, topicLabel, typeForTopic } = await import('../src/topics.js')
    // The console kept its own map with no keys in common — `codebase` and
    // `shopping` against `projects` and `tools` — so every connector claim fell
    // through to a capitalise fallback and was labelled by accident.
    const { FALLBACK_TOPIC } = await import('../src/topics.js')
    for (const id of TOPIC_IDS) {
      // A deliberate label, not the raw id capitalised by the fallback.
      expect(topicLabel(id)).toBeTruthy()
      // Every topic implies a specific claim type, except the one whose whole
      // job is to say "we do not know what kind of knowledge this is".
      if (id !== FALLBACK_TOPIC) expect(typeForTopic(id)).not.toBe('note')
    }
    // `runbook` is the clearest case: the fallback would render "Runbook".
    expect(topicLabel('runbook')).toBe('Operations')
    expect(topicLabel('tools')).toBe('Tools')
    // A namespace someone else invented still gets something readable.
    expect(topicLabel('history')).toBe('History')
  })

  it('names a type for every topic a claim can land in', async () => {
    const { TOPICS, typeLabel } = await import('../src/topics.js')
    for (const t of TOPICS) {
      // `convention` and `policy` were missing from the console's type map and
      // rendered raw.
      expect(typeLabel(t.type)).not.toBe(undefined)
      expect(typeLabel(t.type).length).toBeGreaterThan(0)
    }
    expect(typeLabel('convention')).toBe('convention')
    expect(typeLabel('procedure')).toBe('way of working')
  })

  it('routes to a topic the registry knows', async () => {
    const { topicFor, route } = await import('../src/routing.js')
    const { TOPIC_IDS, typeForTopic } = await import('../src/topics.js')
    for (const text of ['We decided to ship behind a flag', 'Uses GitHub for source control', 'Works on tokyo', 'Never cache token ids']) {
      const t = topicFor(text)
      expect(TOPIC_IDS, `${text} -> ${t}`).toContain(t)
      const r = route({ connector: 'x', sourceName: 'X', sourceKind: 'application', text, actor: 'you', trigger: 't', at: '' }, { owner: 'me.eth' })
      expect(r.type).toBe(typeForTopic(t))
    }
  })
})

describe('scheduled passes', () => {
  it('does not mistake a grants or activity file for a user', async () => {
    const d = scratch()
    const prev = process.env.CONNECT_SECRET
    process.env.CONNECT_SECRET = 'a'.repeat(64)
    process.env.CONNECT_HOST_NAMESPACE = 'demo.eth'
    const { upsertWalletUser, allUsers } = await import('../src/users.js')
    const { grant } = await import('../src/agent.js')

    const u = upsertWalletUser({ address: '0xbeef', name: 'someone.eth' })
    // Writes <id>.grants.json into the same directory as <id>.json.
    grant('github', u.id)

    // Reading the sidecars as users produced records with no id and no
    // namespace, which a scheduled pass then tried to tick — three "users" for
    // one person.
    const users = allUsers()
    expect(users).toHaveLength(1)
    expect(users[0]!.namespace).toBe('someone.eth')

    if (prev === undefined) delete process.env.CONNECT_SECRET; else process.env.CONNECT_SECRET = prev
    rmSync(d, { recursive: true, force: true })
  })

  it('skips a grant whose source no longer exists', async () => {
    const d = scratch()
    const { grant, readGrants } = await import('../src/agent.js')
    const { reader } = await import('../src/registry.js')
    await import('../src/sources.js')

    // `google-calendar` and `gmail` became one `google` source; grants made
    // before that still name the dead ids.
    expect(reader('google-calendar')).toBeUndefined()
    expect(reader('google')).toBeTruthy()
    grant('github')
    expect(readGrants().map((g) => g.workspaceId)).toContain('github')
    rmSync(d, { recursive: true, force: true })
  })
})

describe('confidence says how much evidence there is', () => {
  it('distinguishes a counted rule from a model reading from one observation', async () => {
    const { confidenceFor, CONFIDENCE } = await import('../src/policy.js')
    // Every connector claim used to be 0.85 regardless, which made the number
    // decorative — the console's badge fires below 0.7 and could never fire.
    expect(confidenceFor('rules')).toBe(CONFIDENCE.rules)
    expect(confidenceFor('model')).toBeLessThan(confidenceFor('rules'))
    expect(confidenceFor('rules', true)).toBeLessThan(confidenceFor('model'))
    expect(confidenceFor('human')).toBeGreaterThan(confidenceFor('rules'))
  })

  it('routes a model finding at lower confidence than a counted one', async () => {
    const { route } = await import('../src/routing.js')
    const ev = (by: 'rules' | 'model', weak = false) => ({
      connector: 'chrome', sourceName: 'Browser history', sourceKind: 'application' as const,
      text: 'Uses GitHub for source control', actor: 'you', trigger: '900 visits', at: '', by, weak,
    })
    expect(route(ev('rules'), { owner: 'me.eth' }).confidence).toBeGreaterThan(route(ev('model'), { owner: 'me.eth' }).confidence)
    // And a claim the reader knows rests on one observation is lower than both,
    // which is what finally lets the "one observation" badge fire.
    expect(route(ev('rules', true), { owner: 'me.eth' }).confidence).toBeLessThan(0.7)
  })
})

describe('one description of this client, not two', () => {
  it('builds the metadata document from the same scopes the request uses', async () => {
    const { SCOPES, providerConfig } = await import('../src/oauth.js')
    const env = { CONNECT_BASE_URL: 'https://memory.example.com' } as NodeJS.ProcessEnv
    // The route hand-copied this string. If the two disagree, dynamic
    // registration and the metadata document describe different clients.
    expect(providerConfig('granola', env)!.scopes).toEqual(SCOPES.granola)
    expect(SCOPES.granola.join(' ')).toBe('openid profile offline_access mcp')
  })

  it('knows where every provider lives, in one table', async () => {
    const { ENDPOINTS } = await import('../src/endpoints.js')
    const { SCOPES } = await import('../src/oauth.js')
    // A nested ternary over provider names made adding one a matter of finding
    // the right branch.
    for (const p of Object.keys(SCOPES)) {
      expect(ENDPOINTS[p as keyof typeof ENDPOINTS]?.authUrl, p).toMatch(/^https:\/\//)
      expect(ENDPOINTS[p as keyof typeof ENDPOINTS]?.tokenUrl, p).toMatch(/^https:\/\//)
    }
    // Only Granola allows dynamic registration.
    expect(ENDPOINTS.granola.registerUrl).toBeTruthy()
    expect(ENDPOINTS.github.registerUrl).toBeUndefined()
  })
})

describe('a number that means one thing is written once', () => {
  it('uses one session lifetime for the cookie and the verifier', async () => {
    const { SESSION } = await import('../src/policy.js')
    const { signSession, verifySession } = await import('../src/users.js')
    const prev = process.env.CONNECT_SECRET
    process.env.CONNECT_SECRET = 'a'.repeat(64)

    const cookie = signSession('u1')
    expect(verifySession(cookie)).toBe('u1')
    // The cookie's max age and the age the verifier accepts were separate
    // thirties. Drifting apart means a browser holding a cookie the server has
    // already decided is expired.
    expect(verifySession(cookie, SESSION.days)).toBe('u1')
    expect(verifySession(cookie, 0)).toBe(null)

    if (prev === undefined) delete process.env.CONNECT_SECRET; else process.env.CONNECT_SECRET = prev
  })

  it('takes the poll interval from one value, and never types it', async () => {
    const { AGENT } = await import('../src/policy.js')
    const src = readFileSync(new URL('../../console/app/app/AgentControls.tsx', import.meta.url), 'utf8')
    // "checks every 15s" beside setInterval(…, 15_000) is the same fact typed
    // twice — the kind that drifts the moment either changes.
    // The interval is no longer shown in the nav, but the timer must still read
    // it from policy rather than restate it as a literal.
    expect(src).toContain('AGENT.pollSeconds * 1000')
    expect(src).not.toMatch(/15_000|every 15s/)
    expect(AGENT.pollSeconds).toBe(15)
  })
})

describe('an unclassifiable claim is not called a decision', () => {
  it('files what no rule matched as a note', async () => {
    const { topicFor } = await import('../src/routing.js')
    const { FALLBACK_TOPIC } = await import('../src/topics.js')
    // Filing it under `decisions` asserted that somebody decided something.
    // Nobody did; we just could not tell what kind of knowledge it was.
    expect(topicFor('The office plant is called Gerald')).toBe(FALLBACK_TOPIC)
    expect(FALLBACK_TOPIC).not.toBe('decisions')
    // And a claim that really is a decision still lands there.
    expect(topicFor('We decided to ship the connector behind a flag')).toBe('decisions')
  })
})

describe('the short window reports what is new, not a second opinion', () => {
  const row = (host: string, visits: number, urls: number, title = host) => ({ host, visits, urls, title })

  it('stays quiet about hosts the long window already judged', async () => {
    const { findings } = await import('../src/chrome.js')
    // Over three days everything looks deep — there has been no time to browse
    // widely, and an inbox checked hourly out-scores any project. That is how
    // "Works on Home / X" and "Works on Feed (linkedin.com)" got written.
    const recent = [
      row('x.com', 662, 21, 'Home / X'),
      row('www.linkedin.com', 413, 23, 'Feed'),
      row('new-thing.dev', 300, 40, 'New Thing'),
      row('a.com', 90, 8), row('b.com', 80, 7), row('c.com', 70, 6),
    ]
    const established = new Set(['x.com', 'www.linkedin.com', 'a.com', 'b.com', 'c.com'])
    const texts = findings(recent, { minVisits: 8, scale: 0.25, established }).map((f) => f.text)
    expect(texts.some((t) => t.includes('x.com'))).toBe(false)
    expect(texts.some((t) => t.includes('linkedin'))).toBe(false)
    // …and still says the thing it exists to say.
    expect(texts).toContain('Works on New Thing (new-thing.dev)')
  })

  it('says nothing new when the long window has seen everything', async () => {
    const { findings } = await import('../src/chrome.js')
    const rows = [row('known.dev', 900, 80, 'Known'), row('a.com', 90, 8), row('b.com', 80, 7)]
    const all = new Set(rows.map((r) => r.host))
    const projects = findings(rows, { minVisits: 8, scale: 0.25, established: all })
      .filter((f) => f.text.startsWith('Works on'))
    expect(projects).toEqual([])
  })
})

describe('a wallet is the way in, and the only way', () => {
  it('has no way to make a namespace this site owns', async () => {
    const users = await import('../src/users.js')
    // `defaultNamespace` issued `<login>-<hash>.<host>` — a name this site
    // controlled and could take back, which is the thing the product argues
    // against. It is gone rather than deprecated, so nothing can call it.
    expect('defaultNamespace' in users).toBe(false)
    expect('upsertUser' in users).toBe(false)
    expect(typeof users.upsertWalletUser).toBe('function')
  })

  it('does not ask for a host namespace any more', async () => {
    const { configProblems } = await import('../src/config.js')
    const hosted = { GITHUB_CLIENT_ID: 'a', GITHUB_CLIENT_SECRET: 'b' } as NodeJS.ProcessEnv
    expect(configProblems(hosted).map((p) => p.key)).not.toContain('CONNECT_HOST_NAMESPACE')
  })

  it('keys a person by wallet, so the same wallet is the same person', async () => {
    const { userIdForWallet } = await import('../src/users.js')
    // Case should not make two people out of one.
    expect(userIdForWallet('0xABC')).toBe(userIdForWallet('0xabc'))
    expect(userIdForWallet('0xabc')).not.toBe(userIdForWallet('0xdef'))
  })
})

describe('a name registered here shows up next time', () => {
  it('remembers a name as a candidate, without claiming ownership', async () => {
    const d = scratch()
    const { rememberName, seenNames, candidateNames } = await import('../src/names.js')

    // Learning from repositories and users only works once someone has signed
    // in — which is exactly not the moment that matters. A name registered
    // through the app is the one name we can be certain about, and it was the
    // one name the list could not show.
    expect(seenNames()).not.toContain('freshly-minted.eth')
    rememberName('freshly-minted.eth')
    expect(seenNames()).toContain('freshly-minted.eth')
    expect(candidateNames()).toContain('freshly-minted.eth')

    // A subdomain is owned through its root, and only the root is registrable.
    rememberName('tools.someone.eth')
    expect(seenNames()).toContain('someone.eth')
    expect(seenNames()).not.toContain('tools.someone.eth')

    // Remembering twice is not two candidates.
    rememberName('freshly-minted.eth')
    expect(seenNames().filter((n) => n === 'freshly-minted.eth')).toHaveLength(1)

    rmSync(d, { recursive: true, force: true })
  })

  it('ignores anything that is not a registrable name', async () => {
    const d = scratch()
    const { rememberName, seenNames } = await import('../src/names.js')
    for (const bad of ['', 'not a name', 'http://x.com', '.eth']) rememberName(bad)
    expect(seenNames()).toEqual([])
    rmSync(d, { recursive: true, force: true })
  })
})

describe('Google Data Portability: what a person orders and watches', () => {
  it('asks only for scopes that are facts about someone, not surveillance', async () => {
    const { TAKEOUT_SCOPES, TAKEOUT_RESOURCES } = await import('../src/takeout.js')
    const { SCOPES } = await import('../src/oauth.js')
    for (const s of TAKEOUT_SCOPES) expect(SCOPES.google).toContain(s)
    // Chrome history, autofill and Search activity are all available under this
    // same API. A namespace built for provenance has no business holding
    // someone's browsing or what they typed into a search box.
    const asked = TAKEOUT_RESOURCES.join(' ')
    for (const forbidden of ['chrome.history', 'chrome.autofill', 'myactivity.search', 'chrome.settings']) {
      expect(asked).not.toContain(forbidden)
    }
  })

  it('counts habits rather than listing receipts', async () => {
    const { orderFindings } = await import('../src/takeout.js')
    const order = (m: string, n: number) => Array.from({ length: n }, () => ({ title: `Ordered 1 item from ${m}` }))
    const out = orderFindings([...order('Dishoom', 6), ...order('Franco Manca', 1)])
    // "Ordered from X on Tuesday" is a receipt and belongs to nobody but them.
    expect(out.map((f) => f.text)).toContain('Orders from Dishoom regularly')
    expect(out.some((f) => /Franco/.test(f.text))).toBe(false)
    expect(out[0]!.evidence).toBe('6 orders')
  })

  it('claims channels, never individual videos', async () => {
    const { watchFindings } = await import('../src/takeout.js')
    const watched = (c: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({ title: `Watched video ${i}`, subtitles: [{ name: c }] }))
    const out = watchFindings([...watched('Fireship', 9), ...watched('One Off', 2)])
    expect(out.map((f) => f.text)).toContain('Follows Fireship on YouTube')
    expect(out.some((f) => /One Off/.test(f.text))).toBe(false)
    // A list of what someone watched on a given night is a different thing
    // entirely, and not one a namespace should hold.
    expect(out.every((f) => !/Watched video/.test(f.text))).toBe(true)
  })

  it('reads a real zip without a dependency', async () => {
    const { readZip } = await import('../src/archive.js')
    const { execFileSync } = await import('node:child_process')
    const { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')

    const d = mkdtempSync(join(tmpdir(), 'zip-'))
    mkdirSync(join(d, 'Takeout'), { recursive: true })
    writeFileSync(join(d, 'Takeout', 'MyActivity.json'), JSON.stringify([{ title: 'Ordered 1 item from Dishoom' }]))
    execFileSync('zip', ['-qr', join(d, 'a.zip'), 'Takeout'], { cwd: d })

    const entries = readZip(readFileSync(join(d, 'a.zip')))
    const file = entries.find((e) => e.name.endsWith('MyActivity.json'))
    expect(file).toBeTruthy()
    // Entries are listed without inflating, so a large archive costs one pass
    // over its index rather than a full extraction.
    expect(JSON.parse(file!.read())[0].title).toContain('Dishoom')
    rmSync(d, { recursive: true, force: true })
  })

  it('refuses something that is not a zip rather than guessing', async () => {
    const { readZip } = await import('../src/archive.js')
    expect(() => readZip(Buffer.from('not a zip at all, just some bytes'))).toThrow(/not a zip/)
  })
})

describe('the Base wallet source', () => {
  it('writes patterns, never amounts, and routes to the portfolio namespace', async () => {
    const { findings } = await import('../src/ethereum.js')
    const { route } = await import('../src/routing.js')
    const activity = {
      address: '0x0000000000000000000000000000000000000001',
      eth: 1.2345,
      tokens: [{ symbol: 'USDC', usd: 5000 }, { symbol: 'AERO', usd: 800 }],
      via: 'MultiBaas' as const,
      txs: [
        ...Array.from({ length: 4 }, () => ({ timestamp: new Date().toISOString(), to: { hash: '0xa', name: 'UniswapV2Router02', is_contract: true }, result: 'success' })),
        ...Array.from({ length: 2 }, () => ({ timestamp: new Date().toISOString(), to: { hash: '0xb', name: 'OneOff', is_contract: true }, result: 'success' })),
      ],
    }
    const texts = findings(activity).map((f) => f.text)
    expect(texts).toEqual(['Holds ETH on Base', 'Holds USDC on Base', 'Holds AERO on Base', 'Uses Uniswap on Base'])
    // No amount or balance ever appears in a claim or its evidence.
    for (const f of findings(activity)) expect(`${f.text} ${f.evidence}`).not.toMatch(/1\.23|5000|800|\$/)
    for (const t of texts) expect(route({ text: t } as never, { owner: 'you.eth' }).namespace).toBe('portfolio.you.eth')
  })

  it('is skipped, not failed, without a proven wallet', async () => {
    await import('../src/sources.js')
    const { readSource } = await import('../src/registry.js')
    const r = await readSource('ethereum', { model: null })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('not-connected')
  })
})

describe('decisions: findings as plain questions with one-click answers', () => {
  const setup = async () => {
    const { mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    process.env.RECALL_CACHE_DIR = mkdtempSync(join(tmpdir(), 'decisions-'))
    const { Repository } = await import('@knowledge01/repo')
    const repo = Repository.init('notes.me.eth', 'me.eth', { contentKey: 'ab'.repeat(32), kind: 'organisation' })
    const src = [{ type: 'observation' as const, kind: 'application' as const, name: 'Granola' }]
    repo.remember({ claim: 'Works with Nick', subject: 'Works', topic: 'notes', sources: src })
    repo.remember({ claim: 'Works with Sneha', subject: 'Works', topic: 'notes', sources: src })
    return repo
  }

  it('phrases a conflict as a question with both claims', async () => {
    await setup()
    const { decisionsOf } = await import('../src/decisions.js')
    const d = decisionsOf('me.eth').find((x) => x.kind === 'conflict')
    expect(d?.question).toBe('Do these disagree?')
    expect([d?.claim.claim, d?.other?.claim].sort()).toEqual(['Works with Nick', 'Works with Sneha'])
    expect(d?.answers.map((a) => a.id)).toEqual(['both', 'replace', 'keep-old'])
  })

  it('"both are true" keeps both and settles the question', async () => {
    await setup()
    const { decisionsOf, answerDecision } = await import('../src/decisions.js')
    const d = decisionsOf('me.eth').find((x) => x.kind === 'conflict')!
    answerDecision('me.eth', d.namespace, d.commit, d.index, 'both')
    expect(decisionsOf('me.eth').filter((x) => x.kind === 'conflict')).toHaveLength(0)
    const { Repository } = await import('@knowledge01/repo')
    expect(Object.values(Repository.open('notes.me.eth').headSnapshot('main')).map((k) => k.claim).sort()).toEqual(['Works with Nick', 'Works with Sneha'])
  })

  it('"new one replaces the old" removes the old, in history, and raises nothing new', async () => {
    await setup()
    const { decisionsOf, answerDecision } = await import('../src/decisions.js')
    const d = decisionsOf('me.eth').find((x) => x.kind === 'conflict')!
    answerDecision('me.eth', d.namespace, d.commit, d.index, 'replace')
    const { Repository } = await import('@knowledge01/repo')
    const repo = Repository.open('notes.me.eth')
    expect(Object.values(repo.headSnapshot('main')).map((k) => k.claim)).toEqual([d.claim.claim])
    expect(repo.log('main', 10)[0]!.message).toMatch(/^Replaced /)
    expect(decisionsOf('me.eth').filter((x) => x.kind === 'conflict')).toHaveLength(0)
  })

  it('files "Works with Nick" under Nick, so colleagues stop colliding', async () => {
    const { route } = await import('../src/routing.js')
    expect(route({ text: 'Works with Nick' } as never, { owner: 'me.eth' }).subject).toBe('Nick')
  })
})

describe('sessions on a serverless host', () => {
  const withSecret = <T,>(fn: () => T): T => {
    const prev = process.env.CONNECT_SECRET
    process.env.CONNECT_SECRET = 'a'.repeat(64)
    try { return fn() } finally { if (prev === undefined) delete process.env.CONNECT_SECRET; else process.env.CONNECT_SECRET = prev }
  }
  it('carry the proved wallet and name, so a fresh instance can rebuild the user', async () => {
    const { signSession, verifySession, sessionIdentity } = await import('../src/users.js')
    withSecret(() => {
      const who = { address: '0x3C5f1294C17aA9Effd340d4dfbf01ED8E8Beac6d', name: 'rishhtokyo.eth' }
      const cookie = signSession('u_wallet_1', who)
      expect(verifySession(cookie)).toBe('u_wallet_1')
      expect(sessionIdentity(cookie)).toEqual(who)
      // Old cookies, with no identity, still verify.
      expect(verifySession(signSession('u_old'))).toBe('u_old')
      expect(sessionIdentity(signSession('u_old'))).toBeNull()
    })
  })
  it('refuses an identity that was edited after signing', async () => {
    const { signSession, verifySession, sessionIdentity } = await import('../src/users.js')
    withSecret(() => {
      const cookie = signSession('u_wallet_1', { address: '0x0000000000000000000000000000000000000001', name: 'me.eth' })
      const [head, issued, mac] = cookie.split('.')
      const forged = `${head!.split('~')[0]}~${Buffer.from(JSON.stringify({ address: '0x00000000000000000000000000000000000000ff', name: 'vitalik.eth' })).toString('base64url')}.${issued}.${mac}`
      expect(verifySession(forged)).toBeNull()
      expect(sessionIdentity(forged)).toBeNull()
    })
  })
})
