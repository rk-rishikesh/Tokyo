/**
 * Google — Calendar and Gmail, read through a token the person granted.
 *
 * The boundary here is sharper than anywhere else in this package, because these
 * are the two most sensitive accounts most people have.
 *
 * Calendar: recurring meeting *titles* and how often they recur. A weekly
 * standup is a fact about how someone works. A one-off 1:1 on Thursday is a
 * diary entry, and a namespace is not a diary.
 *
 * Gmail: `gmail.metadata` scope cannot read a message body even if this code
 * asked it to — Google enforces that server side. What is left is headers, and
 * the only thing taken from them is which *services* mail you regularly, from
 * the sender domain. Never a person, never a subject line, never a body.
 */
import type { Finding } from './local-sources.js'
import { POLICY, periodPhrase } from './policy.js'

async function api<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`google ${new URL(url).pathname}: ${res.status}`)
  return res.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

type GEvent = { summary?: string; recurringEventId?: string; attendees?: { email?: string; self?: boolean }[]; start?: { dateTime?: string; date?: string } }

export type Meeting = { title: string; occurrences: number; attendees: number }

/**
 * Meetings that actually recur, over the last 90 days.
 *
 * Grouped by title rather than by `recurringEventId`, because a standup that was
 * recreated when the team changed tools is still the same standup.
 */
export async function recurringMeetings(token: string, opts: { days?: number } = {}): Promise<Meeting[]> {
  const days = opts.days ?? POLICY.google.windowDays
  const timeMin = new Date(Date.now() - days * 86_400_000).toISOString()
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&maxResults=250&singleEvents=true&orderBy=startTime`
  const data = await api<{ items?: GEvent[] }>(url, token)

  const byTitle = new Map<string, { n: number; attendees: number }>()
  for (const e of data.items ?? []) {
    const title = e.summary?.trim()
    if (!title) continue
    // A blocked-out hour is not a meeting.
    if (/^(busy|focus|ooo|out of office|lunch|break|hold|tentative)\b/i.test(title)) continue
    const cur = byTitle.get(title) ?? { n: 0, attendees: 0 }
    byTitle.set(title, { n: cur.n + 1, attendees: Math.max(cur.attendees, e.attendees?.length ?? 0) })
  }
  return [...byTitle]
    .filter(([, v]) => v.n >= POLICY.google.minMeetings)
    .map(([title, v]) => ({ title, occurrences: v.n, attendees: v.attendees }))
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, POLICY.google.keep)
}

export function calendarFindings(meetings: Meeting[], days = POLICY.google.windowDays): Finding[] {
  return meetings.map((m) => ({
    text: `Attends ${m.title} regularly`,
    topic: 'conventions',
    evidence: `${m.occurrences} occurrences${periodPhrase(days)}${m.attendees > 1 ? ` with ${m.attendees} people` : ''}`,
    ref: 'https://calendar.google.com',
  }))
}

// ---------------------------------------------------------------------------
// Gmail — sender domains only
// ---------------------------------------------------------------------------

type GMessage = { id: string; payload?: { headers?: { name: string; value: string }[] } }

/** Domains that mail everyone and say nothing about the person. */
const NOISE = new Set([
  'gmail.com', 'googlemail.com', 'google.com', 'accounts.google.com', 'outlook.com', 'hotmail.com',
  'yahoo.com', 'icloud.com', 'proton.me', 'protonmail.com', 'mail.com',
])

export type Service = { domain: string; messages: number }

/**
 * Which services mail this person, by sender domain.
 *
 * Personal mail domains are dropped: that a friend emailed is not knowledge, and
 * counting individuals would turn this into a social graph. What is left is
 * services — the tools someone actually has accounts with.
 */
export async function mailServices(token: string, opts: { max?: number; days?: number } = {}): Promise<Service[]> {
  const max = opts.max ?? 200
  const days = opts.days ?? POLICY.google.windowDays
  const list = await api<{ messages?: { id: string }[] }>(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}&q=newer_than:${days}d`,
    token,
  )
  const ids = (list.messages ?? []).slice(0, max)
  const counts = new Map<string, number>()

  // Batches of 10, so a large mailbox does not open 200 sockets at once.
  for (let i = 0; i < ids.length; i += 10) {
    const chunk = ids.slice(i, i + 10)
    const msgs = await Promise.all(chunk.map((m) =>
      api<GMessage>(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From`, token)
        .catch(() => null),
    ))
    for (const msg of msgs) {
      const from = msg?.payload?.headers?.find((h) => h.name.toLowerCase() === 'from')?.value
      const domain = from?.match(/@([a-z0-9.-]+)/i)?.[1]?.toLowerCase().replace(/^(mail|email|e|no-?reply|notifications?|updates?)\./, '')
      if (!domain || NOISE.has(domain)) continue
      counts.set(domain, (counts.get(domain) ?? 0) + 1)
    }
  }
  return [...counts]
    .filter(([, n]) => n >= POLICY.google.minMessages)
    .map(([domain, messages]) => ({ domain, messages }))
    .sort((a, b) => b.messages - a.messages)
    .slice(0, 10)
}

export function gmailFindings(services: Service[], days = POLICY.google.windowDays): Finding[] {
  return services.map((s) => ({
    text: `Has an account with ${s.domain}`,
    topic: 'tools',
    evidence: `${s.messages} messages${periodPhrase(days)}`,
    ref: `https://${s.domain}`,
  }))
}
