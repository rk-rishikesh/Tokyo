/**
 * Chat: your memory as context, your connected apps as hands.
 *
 * This is the layer where the product does something the knowledge network
 * deliberately will not. The engine only ever learns — every operation it has
 * is about claims and provenance. A product built on it may act, and this one
 * does, which makes the boundary this file's job to hold rather than inherit.
 *
 * Three rules:
 *
 *   - Memory is context, not decoration. Claims from the person's namespaces go
 *     into the prompt with their sources, so an answer can be traced back the
 *     same way a claim can.
 *   - Reads run; writes ask. A tool that only fetches is called as needed. A
 *     tool that changes something in another product stops and returns what it
 *     would do, for a person to approve. The agent that watches everything is
 *     tolerable because it cannot act; the agent that acts is tolerable because
 *     you said yes in the moment.
 *   - A refusal to act is not a failure. If nothing is connected, or the only
 *     matching tool writes, saying so beats guessing.
 */
import { Repository, RepoStore, repoPath } from '@k01/repo'
import type { Knowledge } from '@k01/core'
import { llmConfig, RateLimited, walkModels, type LlmConfig } from './llm.js'
import { TOPIC_IDS } from './topics.js'
import { callTool, listTools, MCP_ENDPOINTS, type McpServer, type McpTool } from './mcp-client.js'
import { accessToken, type Provider, type User } from './users.js'

export type ChatTurn =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string }

/** A write the model wants to make, held for approval. */
export type PendingAction = {
  tool: string
  server: Provider
  args: Record<string, unknown>
  /** What this would do, in the person's words. */
  summary: string
}

export type ChatAnswer = {
  reply: string
  /** Claims that informed the answer, so it can be traced like a claim can. */
  used: { claim: string; namespace: string; sources: string[] }[]
  /** Reads the agent performed while answering. */
  called: { tool: string; ok: boolean }[]
  /** Writes it wants to make, which need a yes. */
  pending: PendingAction[]
  model: string | null
}


/** Everything this person's namespaces know, with provenance attached. */
export function memoryOf(owner: string): { claim: string; namespace: string; sources: string[] }[] {
  const out: { claim: string; namespace: string; sources: string[] }[] = []
  const names = owner.split('.').length > 2 ? [owner] : TOPIC_IDS.map((t) => `${t}.${owner}`)
  for (const ns of names) {
    if (!RepoStore.exists(repoPath(ns))) continue
    try {
      const repo = Repository.open(ns)
      for (const k of Object.values(repo.headSnapshot(repo.refs.head)) as Knowledge[]) {
        out.push({ claim: k.claim, namespace: ns, sources: k.sources.map((s) => s.name ?? s.type) })
      }
    } catch { /* an unreadable namespace should not break the answer */ }
  }
  return out
}

/** The MCP servers this person has actually connected. */
export function serversFor(user: User): McpServer[] {
  const out: McpServer[] = []
  for (const [id, url] of Object.entries(MCP_ENDPOINTS) as [Provider, string][]) {
    const token = accessToken(user.id, id)
    if (token) out.push({ id, name: id, url, token })
  }
  return out
}

const SYSTEM = `You help someone using their own knowledge namespaces and connected apps.

You are given what their memory already knows. Prefer it over guessing: if the memory
says which tools they use or what they work on, use that rather than asking.

You have tools from apps they connected. Use read tools freely to answer.
For anything that would change something in another app, call the tool — it will be
held for their approval rather than executed, which is what you want.

Answer plainly and briefly. If the memory and a tool disagree, say so.
If you cannot do something because nothing relevant is connected, say that instead of guessing.`

type OpenAiTool = { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }

const asOpenAiTools = (tools: McpTool[]): OpenAiTool[] =>
  tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: `${t.description}${t.writes ? ' (changes data — will be held for approval)' : ''}`.trim(),
      parameters: t.schema as Record<string, unknown>,
    },
  }))

type ApiMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
}

type ToolReply = { content: string; toolCalls: { id: string; name: string; args: Record<string, unknown> }[]; model: string }

/**
 * Ask one model, then the next when it will not answer.
 *
 * Shares the walk with extraction — a free tier that is rate-limited right now
 * is the normal case for both, and chat used to die on the first 429 while the
 * watcher sailed past it. What differs is the success condition: extraction
 * needs JSON, this needs a reply the tool loop can use, so anything non-empty
 * or carrying a tool call counts.
 */
async function askAnyModel(cfg: LlmConfig, messages: ApiMessage[], tools: OpenAiTool[]): Promise<ToolReply> {
  const { result } = await walkModels(
    cfg,
    (model) => callWithTools(cfg, model, messages, tools),
    (r) => !!r.content.trim() || r.toolCalls.length > 0,
    () => 'empty reply',
  )
  return result
}

async function callWithTools(
  cfg: LlmConfig,
  model: string,
  messages: ApiMessage[],
  tools: OpenAiTool[],
): Promise<ToolReply> {
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.apiKey}`,
      'http-referer': 'https://github.com/knowledge-network',
      'x-title': 'Knowledge Network',
    },
    body: JSON.stringify({
      model, messages, temperature: 0, max_tokens: 2000,
      ...(tools.length ? { tools, tool_choice: 'auto' } : {}),
    }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200)
    if (res.status === 429) throw new RateLimited(`${model}: rate-limited`)
    throw new Error(`${model}: ${res.status} ${detail}`)
  }
  const body = (await res.json()) as {
    choices?: { message?: { content?: string; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[]
  }
  const msg = body.choices?.[0]?.message
  return {
    model,
    content: msg?.content ?? '',
    toolCalls: (msg?.tool_calls ?? []).map((c) => {
      let args: Record<string, unknown> = {}
      // A model that emits malformed arguments should lose that call, not the turn.
      try { args = JSON.parse(c.function.arguments || '{}') as Record<string, unknown> } catch { args = {} }
      return { id: c.id, name: c.function.name, args }
    }),
  }
}

/**
 * Answer one message.
 *
 * Runs a bounded tool loop: read tools execute and feed their output back, write
 * tools are collected and the loop stops. The bound matters — a model that keeps
 * calling the same read is a real failure mode, and an unbounded loop spends
 * someone's rate limit discovering that.
 */
export async function ask(
  user: User,
  history: ChatTurn[],
  message: string,
  opts: { maxSteps?: number } = {},
): Promise<ChatAnswer> {
  const cfg = llmConfig()
  const memory = memoryOf(user.namespace)
  if (!cfg) {
    return {
      reply: 'No model is configured, so I cannot answer. Set OPENROUTER_API_KEY and I will use your memory and connected apps.',
      used: [], called: [], pending: [], model: null,
    }
  }

  const servers = serversFor(user)
  const tools = servers.length ? await listTools(servers) : []

  const context = memory.length
    ? `What your memory knows:\n${memory.map((m) => `- ${m.claim} [${m.namespace}${m.sources.length ? `, from ${m.sources.join(', ')}` : ''}]`).join('\n')}`
    : 'Your memory is empty so far.'

  const messages: ApiMessage[] = [
    { role: 'system', content: SYSTEM },
    { role: 'system', content: context },
    ...history.map((t) => ({ role: t.role, content: t.content }) as ApiMessage),
    { role: 'user', content: message },
  ]

  const called: ChatAnswer['called'] = []
  const pending: PendingAction[] = []
  const maxSteps = opts.maxSteps ?? 4
  let reply = ''
  // Which model actually answered, which is not always the one configured.
  let answered = cfg.model

  for (let step = 0; step < maxSteps; step++) {
    const out = await askAnyModel(cfg, messages, asOpenAiTools(tools))
    answered = out.model
    reply = out.content || reply
    if (!out.toolCalls.length) break

    messages.push({
      role: 'assistant',
      content: out.content || null,
      tool_calls: out.toolCalls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: JSON.stringify(c.args) } })),
    })

    let heldAWrite = false
    for (const call of out.toolCalls) {
      const tool = tools.find((t) => t.name === call.name)
      if (tool?.writes) {
        // Stop rather than act. The model is told this happens, so it can say
        // what it is waiting on instead of pretending the work is done.
        pending.push({ tool: call.name, server: tool.server, args: call.args, summary: `${call.name} on ${tool.server}` })
        messages.push({ role: 'tool', tool_call_id: call.id, content: 'Held for the person to approve. Not executed.' })
        heldAWrite = true
        continue
      }
      const result = await callTool(servers, tools, call.name, call.args)
      called.push({ tool: call.name, ok: result.ok })
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: result.ok ? result.text.slice(0, 4000) : `error: ${result.error}`,
      })
    }
    if (heldAWrite) {
      const final = await askAnyModel(cfg, messages, [])
      answered = final.model
      reply = final.content || reply
      break
    }
  }

  return { reply: reply.trim() || 'I could not work out an answer to that.', used: memory, called, pending, model: answered }
}

/** Run an action the person approved. This is the only path that writes to another app. */
export async function approve(user: User, action: PendingAction): Promise<{ ok: boolean; text: string }> {
  const servers = serversFor(user)
  const tools = await listTools(servers)
  const result = await callTool(servers, tools, action.tool, action.args)
  return result.ok ? { ok: true, text: result.text } : { ok: false, text: result.error }
}
