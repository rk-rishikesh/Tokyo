import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let client: Client
let anonClient: Client
let cacheDir: string

beforeAll(async () => {
  cacheDir = mkdtempSync(join(tmpdir(), 'recall-test-'))
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['--import', 'tsx', new URL('../src/index.ts', import.meta.url).pathname],
    env: {
      ...process.env,
      RECALL_CACHE_DIR: cacheDir,
      RECALL_COLLECTIONS: 'exploits.auditor.eth',
      RECALL_SUBSCRIBER_ADDRESS: '0x1111111111111111111111111111111111111111',
    },
  })
  client = new Client({ name: 'test', version: '1.0.0' })
  await client.connect(transport)

  // A second server with no configured subscriber, to check that an
  // unattributable contribution is refused rather than silently anonymised.
  const anonTransport = new StdioClientTransport({
    command: 'node',
    args: ['--import', 'tsx', new URL('../src/index.ts', import.meta.url).pathname],
    env: {
      ...process.env,
      RECALL_CACHE_DIR: cacheDir,
      RECALL_COLLECTIONS: 'exploits.auditor.eth',
      RECALL_SUBSCRIBER_ADDRESS: '',
    },
  })
  anonClient = new Client({ name: 'test-anon', version: '1.0.0' })
  await anonClient.connect(anonTransport)
}, 30_000)

afterAll(async () => {
  await client?.close()
  await anonClient?.close()
  rmSync(cacheDir, { recursive: true, force: true })
})

describe('recall mcp server', () => {
  it('exposes the skills_* tool surface', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([
      'skills_get',
      'skills_list',
      'skills_pin',
      'skills_private_write',
      'skills_propose',
      'skills_search',
    ])
  })

  it('skills_get is read-only', async () => {
    const { tools } = await client.listTools()
    expect(
      tools.find((t) => t.name === 'skills_get')!.annotations?.readOnlyHint,
    ).toBe(true)
  })

  it('skills_propose refuses to build an unattributed contribution', async () => {
    // The server is started without RECALL_SUBSCRIBER_ADDRESS in this case, so
    // there is no author to attribute the entry to.
    const res = await anonClient.callTool({
      name: 'skills_propose',
      arguments: { collection: 'exploits.auditor.eth', title: 'T', body: 'B' },
    })
    const out = (res.content as { text: string }[])[0]!.text
    expect(out).toContain('RECALL_SUBSCRIBER_ADDRESS')
  })

  it('skills_propose signs nothing and says so', async () => {
    const res = await client.callTool({
      name: 'skills_propose',
      arguments: { collection: 'exploits.auditor.eth', title: 'Test finding', body: 'Body' },
    })
    const out = (res.content as { text: string }[])[0]!.text
    // Without a readable collection it reports why; either way it must never claim
    // to have written anything on chain.
    expect(out).not.toMatch(/transaction (sent|submitted)/i)
    expect(out).toMatch(/RECALL: SERVER STATUS/)
  })

  it('marks the read tools read-only', async () => {
    const { tools } = await client.listTools()
    const search = tools.find((t) => t.name === 'skills_search')!
    expect(search.annotations?.readOnlyHint).toBe(true)
  })

  it('stores a private note locally and never publishes it', async () => {
    const res = await client.callTool({
      name: 'skills_private_write',
      arguments: { title: 'Local only note', body: 'secret', tags: ['x'] },
    })
    const out = (res.content as { text: string }[])[0]!.text
    expect(out).toContain('local-only-note')
    expect(out).toContain('not published')
  })

  it('pins and unpins a collection', async () => {
    const pinned = await client.callTool({
      name: 'skills_pin',
      arguments: { collection: 'exploits.auditor.eth', ref: 'bafyTestRef' },
    })
    expect((pinned.content as { text: string }[])[0]!.text).toContain('pinned at bafyTestRef')

    const head = await client.callTool({
      name: 'skills_pin',
      arguments: { collection: 'exploits.auditor.eth', ref: 'head' },
    })
    expect((head.content as { text: string }[])[0]!.text).toContain('follows head')
  })

  it('refuses to pin a collection it is not subscribed to', async () => {
    const res = await client.callTool({
      name: 'skills_pin',
      arguments: { collection: 'not-mine.eth', ref: 'head' },
    })
    expect((res.content as { text: string }[])[0]!.text).toContain('not in RECALL_COLLECTIONS')
  })

  it('returns the untrusted-data banner even when there is nothing to show', async () => {
    const res = await client.callTool({
      name: 'skills_search',
      arguments: { query: 'reentrancy' },
    })
    const out = (res.content as { text: string }[])[0]!.text
    // Either no readable collections (server status) or a banner-prefixed result;
    // both must be labelled so collection content is never mistaken for instructions.
    expect(out).toMatch(/RECALL: (RETRIEVED REFERENCE DATA|SERVER STATUS)/)
  })
}, 30_000)
