/**
 * Agent B, as something a person can open in a browser.
 *
 * A separate process on its own port, deliberately plain: `node:http`, no
 * framework, nothing shared with the console. It asks for access the way an
 * OAuth client does — send the person to their memory app with a public key
 * and a redirect — and after that it never talks to the app again. Everything
 * it shows is read from the network with its own key.
 */
import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { AGENT_NAME, agentDir, answer, grants, identity, networkWhere, readAll, saveGrants, type Reading } from './agent.js'

const PORT = Number(process.env.AGENT_B_PORT ?? 3002)
const SELF = process.env.AGENT_B_URL?.trim() || `http://localhost:${PORT}`
/** Where the person's memory app is. Only used to send them there; never called. */
const MEMORY_APP = process.env.MEMORY_APP_URL?.trim() || 'http://localhost:3000'

/** Outstanding authorisation requests, so a callback cannot be forged by a link. */
const pending = new Map<string, { name: string; at: number }>()

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`

function page(body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agent B</title>
<style>
:root{--bg:#0f1115;--card:#171a21;--line:#262a33;--ink:#e8eaee;--dim:#8a91a0;--ok:#4ade80;--no:#f87171;--accent:#f59e0b}
@media (prefers-color-scheme: light){:root{--bg:#f6f5f2;--card:#fff;--line:#e3e1dc;--ink:#16181d;--dim:#6b6f78;--ok:#15803d;--no:#b91c1c;--accent:#b45309}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif}
main{max-width:860px;margin:0 auto;padding:40px 16px 80px}
h1{font-size:44px;letter-spacing:-.03em;margin:0;text-transform:lowercase;font-weight:600}
.dim{color:var(--dim)}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:18px 20px;margin-top:14px}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
input,button{font:inherit;border-radius:12px;border:1px solid var(--line);padding:10px 14px;background:var(--bg);color:var(--ink)}
button{background:var(--ink);color:var(--bg);border-color:var(--ink);cursor:pointer}
.pill{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:2px 10px;font-size:12px}
.ok{color:var(--ok)}.no{color:var(--no)}
ul{margin:10px 0 0;padding-left:18px}li{margin:4px 0}
pre{white-space:pre-wrap;margin:0}
.tag{color:var(--accent);font-size:12px;letter-spacing:.14em;text-transform:uppercase}
</style></head><body><main>${body}</main></body></html>`
}

function namespaceCard(r: Reading): string {
  if (!r.ok) {
    const label = r.reason === 'denied' ? '🔒 denied — the bytes are ciphertext and this key opens nothing' : r.reason === 'unpublished' ? 'granted, not on chain yet — the owner has to sign' : 'error'
    return `<div class="card"><div class="row"><span class="mono">${esc(r.namespace)}</span><span class="pill no">${esc(label)}</span></div><p class="dim" style="margin:8px 0 0">${esc(r.detail)}</p></div>`
  }
  const d = r.data
  const claims = d.claims.map((c) => `<li>${esc(c.claim)} <span class="dim mono">— ${esc(c.sources.map((s) => s.name ?? s.type).join(', ') || 'unsourced')} · ${Math.round(c.confidence * 100)}%</span></li>`).join('')
  return `<div class="card"><div class="row"><span class="mono">${esc(d.namespace)}</span><span class="pill ok">${d.readers === 'key' ? '🔐 decrypted with my key' : '🌐 public'}</span><span class="pill">v${d.version}</span><span class="dim mono">${esc(d.refsCid.slice(0, 18))}…</span></div>
<ul>${claims || '<li class="dim">no claims</li>'}</ul>
<p class="dim mono" style="margin:10px 0 0">published ${esc(d.publishedAt)} · head ${esc(d.head.slice(0, 7))} · ${d.history.length} version${d.history.length === 1 ? '' : 's'}</p></div>`
}

async function home(q?: { question: string; reply: Awaited<ReturnType<typeof answer>> }): Promise<string> {
  const me = identity()
  const g = grants()
  const readings = await readAll()
  const readable = readings.filter((r) => r.ok).length
  return page(`
<p class="tag">a different program · port ${PORT}</p>
<h1>agent b</h1>
<p class="dim" style="max-width:620px">I was not built by the app that learned about you, and I have never seen its database. I have my own key, generated on first run and kept in <span class="mono">${esc(agentDir())}</span>. Whatever you grant me, I read from the network — <span class="mono">${esc(networkWhere())}</span> — and nothing else.</p>

<div class="card"><div class="row"><span class="dim">my public key</span><span class="mono">${esc(short(me.pubkey))}</span></div>
<form class="row" method="get" action="/request" style="margin-top:12px">
  <input name="name" placeholder="your ENS name, e.g. rishikesh.eth" value="${esc(g.owner ?? '')}" required style="flex:1;min-width:220px">
  <button>${g.namespaces.length ? 'Ask for more access' : 'Request access to your memory'}</button>
</form>
<p class="dim" style="margin:10px 0 0;font-size:13px">You will be sent to your memory app to choose what I may read. I cannot choose for you, and I get nothing you do not tick.</p></div>

${readings.length ? `<h2 style="margin:34px 0 0;font-size:15px" class="dim">What I can read · ${readable} of ${readings.length}</h2>${readings.map(namespaceCard).join('')}` : ''}

${readable ? `<div class="card"><form class="row" method="post" action="/ask">
  <input name="q" placeholder="Ask me something about you" value="${esc(q?.question ?? '')}" style="flex:1;min-width:220px" required><button>Ask</button></form>
  ${q ? `<div style="margin-top:14px"><pre>${esc(q.reply.text)}</pre><p class="dim mono" style="margin:10px 0 0">${q.reply.model ? `phrased by ${esc(q.reply.model)} · ` : ''}from ${q.reply.used.length} claim${q.reply.used.length === 1 ? '' : 's'} in ${esc([...new Set(q.reply.used.map((u) => u.namespace))].join(', '))}</p></div>` : ''}
</div>` : ''}
`)
}

const send = (res: ServerResponse, status: number, body: string, type = 'text/html; charset=utf-8') => {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(body)
}
const redirect = (res: ServerResponse, to: string) => { res.writeHead(303, { location: to }); res.end() }

async function body(req: IncomingMessage): Promise<URLSearchParams> {
  let s = ''
  for await (const chunk of req) { s += chunk; if (s.length > 10_000) break }
  return new URLSearchParams(s)
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', SELF)
  try {
    if (req.method === 'GET' && url.pathname === '/') return send(res, 200, await home())

    if (req.method === 'GET' && url.pathname === '/request') {
      const name = (url.searchParams.get('name') ?? '').trim().toLowerCase()
      if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.eth$/.test(name)) return send(res, 400, page('<p>That is not an ENS name.</p><p><a href="/">back</a></p>'))
      const state = randomBytes(16).toString('hex')
      pending.set(state, { name, at: Date.now() })
      const auth = new URL('/app/authorize', MEMORY_APP)
      auth.searchParams.set('agent', AGENT_NAME)
      auth.searchParams.set('pubkey', identity().pubkey)
      auth.searchParams.set('name', name)
      auth.searchParams.set('role', 'read')
      auth.searchParams.set('redirect_uri', `${SELF}/callback`)
      auth.searchParams.set('state', state)
      return redirect(res, auth.toString())
    }

    if (req.method === 'GET' && url.pathname === '/callback') {
      const state = url.searchParams.get('state') ?? ''
      const req0 = pending.get(state)
      pending.delete(state)
      if (!req0 || Date.now() - req0.at > 15 * 60_000) return send(res, 400, page('<p>This response does not match a request I made.</p><p><a href="/">back</a></p>'))
      if (url.searchParams.get('error')) return redirect(res, '/')
      const granted = (url.searchParams.get('granted') ?? '').split(',').map((s) => s.trim()).filter((s) => s === req0.name || s.endsWith(`.${req0.name}`))
      const denied = (url.searchParams.get('denied') ?? '').split(',').map((s) => s.trim()).filter((s) => s === req0.name || s.endsWith(`.${req0.name}`))
      const prev = grants()
      // The callback is only a hint about where to look. Whether I can read a
      // namespace is decided by the network: a forged `granted` gets ciphertext.
      saveGrants({
        owner: req0.name,
        namespaces: [...new Set([...prev.namespaces, ...granted])],
        requested: [...new Set([...prev.requested, ...denied])].filter((n) => !granted.includes(n)),
      })
      return redirect(res, '/')
    }

    if (req.method === 'POST' && url.pathname === '/ask') {
      const q = ((await body(req)).get('q') ?? '').trim().slice(0, 500)
      return send(res, 200, await home({ question: q, reply: await answer(q) }))
    }

    if (req.method === 'GET' && url.pathname === '/api/memory') {
      return send(res, 200, JSON.stringify(await readAll(), null, 2), 'application/json')
    }

    send(res, 404, page('<p>Not here.</p>'))
  } catch (e) {
    send(res, 500, page(`<p>Something went wrong.</p><pre class="mono">${esc(e instanceof Error ? e.message : String(e))}</pre>`))
  }
})

server.listen(PORT, () => {
  console.log(`${AGENT_NAME} on ${SELF}`)
  console.log(`  own key     ${agentDir()}/key.json`)
  console.log(`  network     ${networkWhere()}`)
  console.log(`  memory app  ${MEMORY_APP} (only to send you there)`)
})
