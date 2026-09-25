/**
 * Granola — who you meet with, from your meeting notes.
 *
 * Granola exposes notes over MCP rather than a REST API, so this speaks
 * JSON-RPC to https://mcp.granola.ai/mcp with the person's own OAuth token.
 *
 * The boundary matters more here than anywhere else in this package. Meeting
 * notes are the densest personal data a knowledge worker has: what was decided,
 * what went wrong, what someone said about a colleague. `list_meetings` returns
 * titles, dates and participant names; `get_meetings` and
 * `get_meeting_transcript` return the notes and the transcript themselves and
 * are never called, whatever the plan allows. A namespace built for provenance
 * must not become a copy of someone's meetings.
 *
 * What is kept is who you work with and how often. "Meets with Sarah regularly"
 * is a durable fact about someone's working life; what Sarah said on Tuesday is
 * a diary entry.
 *
 * The response is XML-ish rather than JSON, and it carries its own warning that
 * the content is participant-written data and not instructions. That warning is
 * correct and this reader honours it: nothing extracted here is ever passed to a
 * model as an instruction, only as text to count.
 */
import type { Finding } from './local-sources.js'
import { POLICY } from './policy.js'

const MCP_URL = 'https://mcp.granola.ai/mcp'

type RpcResult = { content?: { type: string; text?: string }[]; isError?: boolean }

async function rpc<T>(token: string, method: string, params?: unknown): Promise<T> {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`granola ${method}: ${res.status} ${(await res.text()).slice(0, 120)}`)
  const text = await res.text()
  // Streamable HTTP may answer as SSE; the payload is in the `data:` lines.
  const body = text.trimStart().startsWith('{')
    ? text
    : text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('')
  if (!body) throw new Error(`granola ${method}: empty response`)
  const json = JSON.parse(body) as { result?: T; error?: { message: string } }
  if (json.error) throw new Error(`granola: ${json.error.message}`)
  return json.result as T
}

/**
 * Tools this reader will not call, whatever the plan allows.
 *
 * These return note bodies, AI summaries and transcripts — the densest personal
 * data on the connection. Until now the guarantee was a comment, which binds
 * nobody: a later change could call one without anything objecting. Refusing in
 * code means the boundary survives someone who has not read the comment.
 */
const NEVER_CALL = new Set(['get_meetings', 'get_meeting', 'get_note', 'get_notes', 'get_meeting_transcript', 'get_transcript'])

async function callTool(token: string, name: string, args: Record<string, unknown>): Promise<string> {
  if (NEVER_CALL.has(name)) {
    throw new Error(`granola: ${name} returns meeting contents and is never called by this reader`)
  }
  const r = await rpc<RpcResult>(token, 'tools/call', { name, arguments: args })
  return (r.content ?? []).map((c) => c.text ?? '').join('\n')
}

export const neverCalled = (): string[] => [...NEVER_CALL]

/** Which tools this account's plan exposes. */
export async function tools(token: string): Promise<string[]> {
  const r = await rpc<{ tools?: { name: string }[] }>(token, 'tools/list')
  return (r.tools ?? []).map((t) => t.name)
}

/** Who the token belongs to. */
export async function accountInfo(token: string): Promise<{ id: string; login: string }> {
  const text = await callTool(token, 'get_account_info', {})
  const email = text.match(/[\w.+-]+@[\w.-]+\.\w+/)?.[0]
  if (!email) {
    try {
      const j = JSON.parse(text) as { id?: string; user_id?: string; name?: string }
      const id = j.id ?? j.user_id
      if (id) return { id, login: j.name ?? id }
    } catch { /* fall through to the error below */ }
    throw new Error('granola: could not identify the account')
  }
  return { id: email, login: email.split('@')[0]! }
}

export type Meeting = {
  id: string
  title: string
  date: string
  /** Everyone named on the meeting, excluding the note's creator. */
  participants: { name: string; email: string; org?: string }[]
}

const unescapeXml = (s: string): string =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")

/**
 * Parse the meeting list.
 *
 * Granola answers with XML-ish markup, not JSON — an earlier version of this
 * reader assumed JSON, silently fell through to splitting on newlines, and
 * produced nothing at all from a working connection. Only the attributes and
 * the participant line are read; the body of a note is never in this response
 * and is never requested.
 */
export function parseMeetings(xml: string): Meeting[] {
  const out: Meeting[] = []
  for (const m of xml.matchAll(/<meeting\s([^>]*)>([\s\S]*?)<\/meeting>/g)) {
    const attrs = m[1] ?? ''
    const body = m[2] ?? ''
    const attr = (name: string) => attrs.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? ''

    const participants: Meeting['participants'] = []
    const known = body.match(/<known_participants>([\s\S]*?)<\/known_participants>/)?.[1] ?? ''
    for (const raw of unescapeXml(known).split(',')) {
      const line = raw.trim()
      if (!line) continue
      const email = line.match(/<([^>]+@[^>]+)>/)?.[1]
      if (!email) continue
      // "Rishikesh Kale (note creator) from Fil <rishikesh@fil.builders>"
      const before = line.slice(0, line.indexOf('<')).trim()
      if (/\(note creator\)/i.test(before)) continue
      const org = before.match(/\bfrom\s+([^<]+)$/i)?.[1]?.trim()
      const name = before.replace(/\(note creator\)/i, '').replace(/\bfrom\s+[^<]+$/i, '').trim()
      participants.push({ name: name || email.split('@')[0]!, email, ...(org ? { org } : {}) })
    }

    const title = attr('title')
    if (!title) continue
    out.push({ id: attr('id'), title, date: attr('date'), participants })
  }
  return out
}

/**
 * Meetings from the person's own notes.
 *
 * Only `list_meetings` is called. The tools that return note bodies and
 * transcripts exist on this connection and are deliberately never used.
 */
export async function meetings(token: string, opts: { limit?: number } = {}): Promise<Meeting[]> {
  const available = await tools(token)
  if (!available.includes('list_meetings')) return []
  return parseMeetings(await callTool(token, 'list_meetings', { limit: opts.limit ?? 100 }))
}

/** Words that make a title a placeholder rather than a subject. */
const GENERIC = /^(meeting|call|catch[- ]?up|sync|chat|1:1|one[- ]on[- ]one|standup|stand[- ]?up|huddle|discussion)$/i

const normaliseTitle = (title: string): string =>
  title
    .toLowerCase()
    .replace(/\s*[-–—|]\s*.*$/, '')
    .replace(/\b\d{1,2}[/.]\d{1,2}([/.]\d{2,4})?\b/g, '')
    .replace(/\b(week|wk|day)\s*\d+\b/g, '')
    .replace(/\b(mon|tue|wed|thu|fri)(day)?\b/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Claims from meetings.
 *
 * Two kinds, and the people matter more than the titles. Who someone meets with
 * repeatedly is a fact about their working life that survives the meeting; a
 * recurring *title* is a fact about their calendar. Both are kept, at different
 * bars — an earlier version required a title to recur three times, which meant
 * a real connection with real meetings produced nothing at all.
 */
export function findings(all: Meeting[]): Finding[] {
  if (!all.length) return []
  const out: Finding[] = []
  const min = POLICY.granola.min

  // Who you actually work with.
  const people = new Map<string, { name: string; org?: string; n: number }>()
  for (const m of all) {
    for (const p of m.participants) {
      const key = p.email.toLowerCase()
      const cur = people.get(key) ?? { name: p.name, ...(p.org ? { org: p.org } : {}), n: 0 }
      people.set(key, { ...cur, n: cur.n + 1 })
    }
  }
  for (const p of [...people.values()].sort((a, b) => b.n - a.n).slice(0, POLICY.granola.keep)) {
    if (p.n < 2) continue
    out.push({
      text: p.org ? `Works with ${p.name} at ${p.org}` : `Works with ${p.name}`,
      topic: 'projects',
      evidence: `${p.n} meetings together`,
      ref: 'https://granola.ai',
    })
  }

  // Meetings that recur by name.
  const titles = new Map<string, { display: string; n: number }>()
  for (const m of all) {
    const key = normaliseTitle(m.title)
    if (key.length < 3 || GENERIC.test(key)) continue
    const cur = titles.get(key) ?? { display: m.title.trim(), n: 0 }
    titles.set(key, { display: cur.display, n: cur.n + 1 })
  }
  for (const t of [...titles.values()].sort((a, b) => b.n - a.n).slice(0, POLICY.granola.keep)) {
    if (t.n < min) continue
    out.push({
      text: `Attends ${t.display} regularly`,
      topic: 'conventions',
      evidence: `${t.n} meetings with this title`,
      ref: 'https://granola.ai',
    })
  }

  // One meeting is enough to know the tool is in use — and without this, a new
  // account that has had a single call gets nothing at all from a connection
  // that is working perfectly.
  out.push({
    text: 'Keeps meeting notes in Granola',
    topic: 'tools',
    evidence: `${all.length} meeting${all.length === 1 ? '' : 's'} recorded`,
    ref: 'https://granola.ai',
    // One meeting is enough to know the tool is in use, and not enough to be
    // as sure as a counted pattern.
    ...(all.length < 3 ? { weak: true } : {}),
  })
  return out
}

/** Kept for callers that only want recurring titles. */
export const recurringNotes = async (token: string, opts: { limit?: number } = {}): Promise<{ title: string; count: number }[]> => {
  const all = await meetings(token, opts)
  const titles = new Map<string, { display: string; n: number }>()
  for (const m of all) {
    const key = normaliseTitle(m.title)
    if (key.length < 3 || GENERIC.test(key)) continue
    const cur = titles.get(key) ?? { display: m.title.trim(), n: 0 }
    titles.set(key, { display: cur.display, n: cur.n + 1 })
  }
  return [...titles.values()].filter((t) => t.n >= POLICY.granola.min).map((t) => ({ title: t.display, count: t.n }))
}
