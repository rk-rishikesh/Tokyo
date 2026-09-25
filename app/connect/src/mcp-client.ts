/**
 * Talking to the MCP servers a person has connected.
 *
 * Granola proved the shape: one POST of JSON-RPC to a streamable-HTTP endpoint,
 * with the person's own OAuth token. This generalises it, because the same
 * transport reaches Linear's and GitHub's servers too — which means the apps a
 * person connects to *write* memory are the same ones that can act on it.
 *
 * Two boundaries are enforced here rather than promised in the UI:
 *
 *   - A tool is only callable if its server is one this person connected. The
 *     model names a tool; it does not get to name a server or an endpoint.
 *   - Read and write are separated, so the caller can offer a tool list that
 *     cannot change anything. `writes: false` is the default for a reason.
 */
import type { Provider } from './users.js'

export type McpServer = {
  id: Provider
  name: string
  url: string
  /** Bearer token belonging to the person, never to this deployment. */
  token: string
}

export type McpTool = {
  name: string
  description: string
  schema: Record<string, unknown>
  /** Which server it came from, so a call can be routed back without trusting the model. */
  server: Provider
  /** Whether calling it changes something in the other product. */
  writes: boolean
}

/** Endpoints for the providers whose MCP servers we know how to reach. */
export const MCP_ENDPOINTS: Partial<Record<Provider, string>> = {
  granola: 'https://mcp.granola.ai/mcp',
  linear: 'https://mcp.linear.app/mcp',
  github: 'https://api.githubcopilot.com/mcp/',
}

/**
 * Whether a tool changes anything.
 *
 * Servers do not reliably declare this, and the cost of guessing wrong is
 * asymmetric: treating a write as a read means the agent silently files an
 * issue nobody approved. So the default is "this writes" and only names that
 * clearly read are exempted.
 */
const WRITE_VERB = /\b(create|update|delete|send|post|write|modify|add|remove|assign|close|merge|archive|cancel|publish|invite|revoke)\b/i

export function isReadOnly(name: string, description = ''): boolean {
  // A write verb anywhere disqualifies the tool, whichever half it appears in.
  // This is checked first on purpose: `list_and_close_stale` starts with a read
  // prefix, and letting the prefix win would classify a tool that closes issues
  // as safe to call unattended.
  if (WRITE_VERB.test(name) || WRITE_VERB.test(description)) return false
  return /^(list|get|search|read|find|query|fetch|describe)([_-]|$)/.test(name)
}

async function rpc<T>(server: McpServer, method: string, params?: unknown): Promise<T> {
  const res = await fetch(server.url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${server.token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`${server.name} ${method}: ${res.status}`)
  const text = await res.text()
  // Streamable HTTP may answer as SSE; the payload is in the `data:` lines.
  const body = text.trimStart().startsWith('{')
    ? text
    : text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('')
  if (!body) throw new Error(`${server.name} ${method}: empty response`)
  const json = JSON.parse(body) as { result?: T; error?: { message: string } }
  if (json.error) throw new Error(`${server.name}: ${json.error.message}`)
  return json.result as T
}

/** Every tool the connected servers offer, tagged with where it came from. */
export async function listTools(servers: McpServer[]): Promise<McpTool[]> {
  const out: McpTool[] = []
  for (const s of servers) {
    try {
      const r = await rpc<{ tools?: { name: string; description?: string; inputSchema?: Record<string, unknown> }[] }>(s, 'tools/list')
      for (const t of r.tools ?? []) {
        out.push({
          name: t.name,
          description: t.description ?? '',
          schema: t.inputSchema ?? { type: 'object', properties: {} },
          server: s.id,
          writes: !isReadOnly(t.name, t.description ?? ''),
        })
      }
    } catch (e) {
      // One server being down must not cost the others.
      console.warn(`mcp ${s.name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return out
}

export type ToolResult = { ok: true; text: string } | { ok: false; error: string }

/**
 * Call one tool, on the server that declared it.
 *
 * The model supplies a name and arguments. It does not supply a URL or a token:
 * those come from `tools`, which came from servers this person connected. A
 * name the list does not contain is refused rather than looked up.
 */
export async function callTool(
  servers: McpServer[],
  tools: McpTool[],
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const tool = tools.find((t) => t.name === name)
  if (!tool) return { ok: false, error: `${name} is not connected` }
  const server = servers.find((s) => s.id === tool.server)
  if (!server) return { ok: false, error: `${tool.server} is not connected` }

  try {
    const r = await rpc<{ content?: { type: string; text?: string }[]; isError?: boolean }>(server, 'tools/call', { name, arguments: args })
    const text = (r.content ?? []).map((c) => c.text ?? '').join('\n').trim()
    if (r.isError) return { ok: false, error: text || 'the tool reported an error' }
    return { ok: true, text: text || '(no output)' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
