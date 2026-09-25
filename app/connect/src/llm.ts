/**
 * LLM extraction over OpenRouter.
 *
 * The rule-based readers can only recognise what is in their table: eight host
 * patterns, a keyword list. Anything outside it is invisible, which is why the
 * same four claims kept appearing. A model reads the actual titles and infers
 * what someone is doing — a domain nobody hardcoded, a tool that shipped last
 * month, a subject rather than a brand.
 *
 * Three rules hold regardless of which path produced a claim, because the
 * product's guarantee is provenance, not cleverness:
 *
 *   - Every claim still cites the evidence it came from. The model is told to
 *     ground each one in the rows it was given, and a claim whose host is not in
 *     the input is dropped rather than trusted.
 *   - The model proposes; it never commits. Output goes through the same
 *     `isKnowledge` gate, the same routing, the same review policy.
 *   - No key, no LLM. Extraction falls back to the rules, and the UI says which
 *     path produced a claim, because "an AI said so" is not provenance.
 */
import type { SiteRow } from './chrome.js'
import type { Finding } from './local-sources.js'
import { MODEL_TOPICS } from './topics.js'

export type LlmConfig = { apiKey: string; model: string; baseUrl: string; fallbacks?: string[] }

/**
 * Free models, in preference order.
 *
 * Extraction is a small structured-output job on ~30 rows, so a free model is
 * enough — paying per poll for this would be silly. Free tiers rate-limit hard,
 * which is why there is a list rather than one id: a 429 moves to the next.
 *
 * The daily cap is per account, not per model, so on a busy day the whole list
 * can be exhausted at once. That is worth saying plainly when it happens rather
 * than reporting it as a failure — every one of these supports tool calling, so
 * the list also serves chat.
 */
export const FREE_MODELS = [
  'qwen/qwen3.8-27b:free',
  'google/gemma-4-31b-it:free',
  'nvidia/nemotron-3.5-lightning:free',
  'inclusionai/ling-3.0-flash-vl:free',
  'nex-agi/nex-n2.5-mini:free',
  'dots-studio/dots-3-note-preview:free',
  'poolside/laguna-s-2.1:free',
]

/** OpenRouter by default; any OpenAI-compatible endpoint works. */
export function llmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig | null {
  // Empty strings are the normal state of a commented-out .env line, so treat
  // them as unset rather than as a value — `??` alone would send model: "".
  const apiKey = env.OPENROUTER_API_KEY?.trim() || env.OPENAI_API_KEY?.trim()
  if (!apiKey) return null
  const model = env.KNOWLEDGE_MODEL?.trim() || FREE_MODELS[0]!
  return {
    apiKey,
    model,
    baseUrl: env.OPENROUTER_BASE_URL?.trim() || (env.OPENROUTER_API_KEY?.trim() ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1'),
    // Only fall back among free models, and never back to the one already chosen.
    fallbacks: FREE_MODELS.filter((m) => m !== model),
  }
}

export const llmAvailable = (env: NodeJS.ProcessEnv = process.env): boolean => !!llmConfig(env)

type ChatMessage = { role: 'system' | 'user'; content: string }

async function callModel(cfg: LlmConfig, model: string, messages: ChatMessage[], timeoutMs: number): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.apiKey}`,
        // OpenRouter asks callers to identify themselves; harmless elsewhere.
        'http-referer': 'https://github.com/knowledge-network',
        'x-title': 'Knowledge Network',
      },
      body: JSON.stringify({ model, messages, temperature: 0, max_tokens: 4000 }),
      signal: controller.signal,
    })
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 160)
      if (res.status === 429) throw new RateLimited(`${model}: rate-limited`)
      throw new Error(`${model}: ${res.status} ${detail}`)
    }
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    return body.choices?.[0]?.message?.content ?? ''
  } finally {
    clearTimeout(timer)
  }
}

/** Which model actually answered — recorded on the claim, so provenance is exact. */
export type ChatResult = { content: string; model: string }

/**
 * Try the chosen model, then the other free ones.
 *
 * A free tier that is rate-limited right now is the normal case, not an error
 * worth losing a poll over. The model that answered is returned so the claim
 * cites the one that actually read the data.
 */
/**
 * Try the chosen model, then the other free ones.
 *
 * A model "answered" only when its reply yields usable JSON. Some free models
 * are reasoning-tuned and return a page of deliberation that parses to nothing —
 * treating that as success stops the chain at a model that cannot do the job,
 * while a working one sits next in the list. Rate limits are the other normal
 * case, and neither is worth losing a poll over.
 */
/**
 * Walk the models until one answers, whatever "answers" means to the caller.
 *
 * Two callers need this with different success conditions — extraction wants a
 * reply that parses to JSON, chat wants one the tool loop can use — so the walk
 * is shared and the condition is not. Both must tell a rate limit apart from a
 * real failure, because on a free tier the first is the normal case.
 */
export class RateLimited extends Error {}

export async function walkModels<T>(
  cfg: LlmConfig,
  attempt: (model: string) => Promise<T>,
  accept: (result: T) => boolean,
  describe: (result: T) => string,
): Promise<{ result: T; model: string }> {
  const tried: string[] = []
  let best: { result: T; model: string } | null = null
  let allRateLimited = true

  for (const model of [cfg.model, ...(cfg.fallbacks ?? [])]) {
    try {
      const result = await attempt(model)
      if (accept(result)) return { result, model }
      // Keep the first usable-but-unaccepted reply: if every model deliberates
      // and none satisfies the caller, one of them beats an error.
      if (!best) best = { result, model }
      allRateLimited = false
      tried.push(`${model}: ${describe(result)}`)
    } catch (e) {
      if (!(e instanceof RateLimited)) allRateLimited = false
      tried.push(e instanceof Error ? e.message : String(e))
    }
  }
  if (best) return best
  throw new Error(
    allRateLimited
      ? 'Every free model is rate-limited right now. OpenRouter caps free requests per day across the whole account, so this clears on its own — or set KNOWLEDGE_MODEL to a paid model.'
      : `No model answered — ${tried.join(' · ')}`,
  )
}

async function chat(cfg: LlmConfig, messages: ChatMessage[], opts: { timeoutMs?: number } = {}): Promise<ChatResult> {
  const timeoutMs = opts.timeoutMs ?? 30_000
  const { result, model } = await walkModels(
    cfg,
    (m) => callModel(cfg, m, messages, timeoutMs),
    (content) => parseJsonArray(content).length > 0,
    () => 'no JSON in reply',
  )
  return { content: result, model }
}

/**
 * Get an array out of whatever the model returned.
 *
 * Small free models are looser than frontier ones about output format: they add
 * prose, wrap in fences, emit `{"claims": [...]}` instead of a bare array, or
 * leave a trailing comma. Each of those is cheap to recover from, and the
 * alternative — dropping a whole poll because of a stray character — is worse.
 */
export function parseJsonArray(raw: string): unknown[] {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const bracketed = raw.indexOf('[') >= 0 ? raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1) : ''
  const braced = raw.indexOf('{') >= 0 ? raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1) : ''
  const candidates = [fenced?.[1], raw, bracketed, braced].filter(Boolean) as string[]

  for (const c of candidates) {
    const text = c.trim()
    // A reply cut off by a token limit ends mid-object. The objects before the
    // cut are still good, and throwing away a whole poll for the last one is
    // the wrong trade — so close the array after the last complete object.
    const truncated = text.startsWith('[') && !text.trimEnd().endsWith(']')
      ? `${text.slice(0, text.lastIndexOf('},') + 1)}]`
      : ''
    for (const attempt of [text, text.replace(/,(\s*[\]}])/g, '$1'), truncated].filter(Boolean)) {
      try {
        const v: unknown = JSON.parse(attempt)
        if (Array.isArray(v)) return v
        // Some models wrap the array in an object: {"claims": [...]}.
        if (v && typeof v === 'object') {
          const inner = Object.values(v as Record<string, unknown>).find((x) => Array.isArray(x))
          if (Array.isArray(inner)) return inner
          // A single object where an array of one was asked for.
          if ('claim' in (v as Record<string, unknown>)) return [v]
        }
      } catch { /* try the next shape */ }
    }
  }
  return []
}

/**
 * Kept short and positive on purpose.
 *
 * A long prompt with a list of prohibitions made a small free model return an
 * empty string — it reads "do not X" and stops answering. Frontier models
 * tolerate that style; a 27B free one does not. Everything the prohibitions
 * used to enforce is enforced in code instead: grounding against the input, the
 * `isKnowledge` gate, and routing. The prompt asks for what we want; the
 * pipeline rejects what we do not.
 */
const SYSTEM = `Turn these browsing totals into durable facts about how this person works.

Write claims like:
[{"claim":"Works on Loops House, an AI hackathon platform","topic":"projects","host":"loops.house","confidence":0.9},
 {"claim":"Uses Vercel for deployment","topic":"tools","host":"vercel.com","confidence":0.8},
 {"claim":"Studies Rust systems programming","topic":"interests","host":"rust-lang.org","confidence":0.7}]

Name the subject, not the brand. Copy host exactly from a row given. Skip email, search and social sites.
topic is one of: ${MODEL_TOPICS.join(', ')}.

Return ONLY the JSON array.`

/**
 * Ask the model what a person's browsing says about them.
 *
 * Titles carry most of the signal — "Rust Programming Language" tells you what
 * `rust-lang.org` is; the host alone does not. Only aggregates are sent: host,
 * a representative title, and counts. No URLs, no timestamps, no page contents.
 */
export async function extractFromBrowsing(rows: SiteRow[], cfg: LlmConfig, opts: { limit?: number } = {}): Promise<Finding[]> {
  const input = rows.slice(0, opts.limit ?? 30).map((r) => ({ host: r.host, title: r.title.slice(0, 80), visits: r.visits, pages: r.urls }))
  if (!input.length) return []
  const { content: raw, model } = await chat(cfg, [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `Browsing totals for one person over the period. Visits are per site, not per page.\n\n${JSON.stringify(input, null, 1)}` },
  ])
  const hosts = new Set(input.map((r) => r.host))
  const out: Finding[] = []
  for (const item of parseJsonArray(raw)) {
    const o = item as { claim?: unknown; topic?: unknown; host?: unknown; confidence?: unknown }
    if (typeof o.claim !== 'string' || o.claim.trim().length < 10) continue
    // Grounding check: a claim about a host that was not in the input is a
    // hallucination, whatever it says about itself.
    const host = typeof o.host === 'string' ? o.host : ''
    if (!hosts.has(host)) continue
    const row = input.find((r) => r.host === host)!
    out.push({
      text: o.claim.trim(),
      topic: typeof o.topic === 'string' && MODEL_TOPICS.includes(o.topic) ? o.topic : 'interests',
      evidence: `${row.visits} visits across ${row.pages} pages · read by ${model}`,
      ref: `https://${host}`,
    })
  }
  return out
}

/** The same, for the projects an editor has open: names and declared stacks. */
export async function extractFromProjects(projects: { name: string; path: string; stack: string[] }[], cfg: LlmConfig): Promise<Finding[]> {
  if (!projects.length) return []
  const { content: raw, model } = await chat(cfg, [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `Projects open in this person's editor, with the dependencies each declares.\n\n${JSON.stringify(projects.slice(0, 20), null, 1)}` },
  ])
  const names = new Set(projects.map((p) => p.name.toLowerCase()))
  const out: Finding[] = []
  for (const item of parseJsonArray(raw)) {
    const o = item as { claim?: unknown; topic?: unknown; host?: unknown }
    if (typeof o.claim !== 'string' || o.claim.trim().length < 10) continue
    // Grounded if it names a project we actually sent.
    const grounded = [...names].some((n) => o.claim!.toString().toLowerCase().includes(n))
    if (!grounded) continue
    out.push({
      text: o.claim.trim(),
      topic: typeof o.topic === 'string' && MODEL_TOPICS.includes(o.topic) ? o.topic : 'projects',
      evidence: `open in your editor · read by ${model}`,
    })
  }
  return out
}
