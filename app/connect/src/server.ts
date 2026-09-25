/**
 * `knowledge-connect` — the local service connected applications post to.
 *
 * It runs on your machine, holds no wallet, and writes only to namespaces you
 * own. Publishing stays a separate step (`knowledge push`), so a connector can
 * never spend your gas or move your pointer. That is the whole difference from
 * a hosted assistant: the apps write into your memory, not into theirs.
 *
 *   POST /slack/events     Slack Events API + slash commands (real)
 *   POST /event            any connector, as a ConnectorEvent (real)
 *   GET  /activity         what has been written, newest first
 *   GET  /health           connectors and their mode
 */
import { config as loadEnv } from 'dotenv'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { existsSync } from 'node:fs'
import { CONNECTORS, fromSlack, slackChallenge } from './connectors.js'
import { connectOwner, ingest, markPublished, readActivity, type IngestOptions, type Outcome } from './ingest.js'
import { publishIfDue, publishKey, type PublishResult } from './publish.js'
import type { ConnectorEvent } from './routing.js'

for (const p of ['.env', '../.env', '../../.env']) if (existsSync(p)) loadEnv({ path: p })

const PORT = Number(process.env.CONNECT_PORT ?? 4319)
const OWNER = connectOwner()
const OPTS: IngestOptions = { owner: OWNER, create: true }
/** With a key present, publish on the namespace's own cadence after each write. */
const AUTO_PUBLISH = process.env.CONNECT_AUTO_PUBLISH !== 'false' && !!publishKey()

/**
 * Publish in the background: a connector's response must not wait on a chain.
 * Errors are logged, never thrown — a failed publish leaves the commit intact
 * and the next write tries again.
 */
function publishLater(outcome: Outcome, force = false): void {
  if (!AUTO_PUBLISH || outcome.status !== 'committed') return
  const ns = outcome.namespace
  void publishIfDue(ns, { force }).then((r: PublishResult) => {
    if (r.status === 'published') {
      const n = markPublished(ns, { at: new Date().toISOString(), version: r.version, contenthash: r.contenthash, tx: r.tx })
      console.log(`  published ${ns} v${r.version} (${r.commits} commit(s), ${n} entries stamped)${r.tx ? ` tx ${r.tx}` : ''}`)
    } else if (r.status === 'unregistered') {
      console.warn(`  ${ns} is not registered on chain — claims are safe locally. To publish: ${r.hint}`)
    } else if (r.status === 'not-owner') {
      console.warn(`  not publishing ${ns}: owned by ${r.owner}, wallet is ${r.wallet}`)
    } else if (r.status === 'error') {
      console.warn(`  publish failed for ${ns}: ${r.reason}`)
    }
  })
}

const json = (res: ServerResponse, code: number, body: unknown): void => {
  const s = JSON.stringify(body)
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'content-length': Buffer.byteLength(s) })
  res.end(s)
}

const readBody = (req: IncomingMessage): Promise<unknown> =>
  new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => { raw += c; if (raw.length > 1_000_000) req.destroy() })
    req.on('end', () => {
      if (!raw) return resolve({})
      try { return resolve(JSON.parse(raw)) } catch { /* Slack sends slash commands form-encoded */ }
      resolve(Object.fromEntries(new URLSearchParams(raw)))
    })
  })

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' }); return res.end() }

  if (url.pathname === '/health') {
    return json(res, 200, {
      ok: true, owner: OWNER, connectors: CONNECTORS, autoPublish: AUTO_PUBLISH,
      note: AUTO_PUBLISH
        ? 'Writes to namespaces you own and publishes on each namespace’s own cadence, signing with the key you gave it.'
        : 'Writes locally to namespaces you own. No key given, so publishing stays a separate step: knowledge push.',
    })
  }

  if (url.pathname === '/activity') {
    return json(res, 200, { activity: readActivity(Number(url.searchParams.get('limit') ?? 50)) })
  }

  if (req.method !== 'POST') return json(res, 404, { error: 'not found' })
  const body = await readBody(req)

  if (url.pathname === '/slack/events') {
    const challenge = slackChallenge(body as Parameters<typeof slackChallenge>[0])
    if (challenge) return json(res, 200, { challenge })
    const event = fromSlack(body as Parameters<typeof fromSlack>[0])
    if (!event) return json(res, 200, { ignored: true, reason: 'not a marked message — nothing is read from channel traffic' })
    const outcome = ingest(event, OPTS)
    publishLater(outcome)
    return json(res, 200, { outcome })
  }

  if (url.pathname === '/event') {
    const e = body as Partial<ConnectorEvent>
    if (!e.text || !e.connector) return json(res, 400, { error: 'connector and text are required' })
    const outcome = ingest({ sourceName: e.sourceName ?? e.connector, sourceKind: e.sourceKind ?? 'application', actor: e.actor ?? 'someone', trigger: e.trigger ?? 'api', at: new Date().toISOString(), ...e } as ConnectorEvent, OPTS)
    publishLater(outcome, url.searchParams.get('publish') === 'now')
    return json(res, 200, { outcome })
  }

  if (url.pathname === '/publish') {
    const ns = (body as { namespace?: string }).namespace
    const force = (body as { force?: boolean }).force !== false
    if (!ns) return json(res, 400, { error: 'namespace is required' })
    const result = await publishIfDue(ns, { force })
    // Stamp here too: a publish counts however it was triggered.
    if (result.status === 'published') markPublished(ns, { at: new Date().toISOString(), version: result.version, contenthash: result.contenthash, tx: result.tx })
    return json(res, 200, { result })
  }

  return json(res, 404, { error: 'not found' })
})

server.listen(PORT, () => {
  console.log(`knowledge-connect listening on http://localhost:${PORT}`)
  console.log(`  owner:      ${OWNER}  → claims land in <topic>.${OWNER}`)
  console.log(`  connectors: ${CONNECTORS.map((c) => c.name).join(', ')}`)
  console.log(AUTO_PUBLISH
    ? '  auto-publish: ON — signs with the key you gave it, on each namespace’s own cadence'
    : '  auto-publish: OFF — no key given; publishing stays a separate step (knowledge push)')
})
