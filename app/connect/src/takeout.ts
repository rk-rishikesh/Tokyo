/**
 * Google Data Portability — the one route to what a person buys, orders and watches.
 *
 * Food delivery, e-commerce and travel are closed to third parties. Every API
 * DoorDash, Uber Eats, Deliveroo, Zomato or Amazon publishes is merchant-side;
 * none of them lets a person read their own order history. Regulation does not
 * rescue it either: GDPR Article 20's "where technically feasible" has been a
 * dead letter for a decade, and the Data Act's real-time clause reaches
 * connected devices rather than order histories.
 *
 * Google's Data Portability API is the exception, and it exists because the DMA
 * compelled it. One OAuth relationship covers food orders and reservations,
 * shopping activity, YouTube watch history — which the YouTube Data API has
 * refused to return since 2016 — Maps places and Play purchases.
 *
 * It is not a query API. The shape is: ask for an archive, poll until it is
 * built, download the files. That matters for how this is used — a pass cannot
 * expect an answer in the same request, so initiating and reading are separate
 * steps and the job id is kept between them.
 *
 * Endpoints and payload shapes here were read from the live discovery document
 * at https://dataportability.googleapis.com/$discovery/rest?version=v1 rather
 * than from prose.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { Finding } from './local-sources.js'
import { POLICY } from './policy.js'

const API = 'https://dataportability.googleapis.com/v1'

/**
 * The resources worth asking for.
 *
 * Deliberately narrow. Every scope here is one a person would recognise as a
 * fact about themselves; Chrome history, autofill and Search activity are
 * available and deliberately not requested — a namespace built for provenance
 * has no business holding someone's browsing or what they typed into a search
 * box.
 */
export const TAKEOUT_RESOURCES = [
  'myactivity.shopping',
  'myactivity.youtube',
  'myactivity.play',
  'order_reserve.purchases_reservations',
  'maps.starred_places',
  'maps.reviews',
  'play.purchases',
  'play.subscriptions',
] as const

export const TAKEOUT_SCOPES = TAKEOUT_RESOURCES.map((r) => `https://www.googleapis.com/auth/dataportability.${r}`)

export type ArchiveJob = {
  jobId: string
  /** `ONE_TIME` or `TIME_BASED` — whether this grant can be asked again. */
  accessType?: string
  startedAt: string
  resources: string[]
}

export type ArchiveState =
  | { state: 'in-progress'; jobId: string }
  | { state: 'complete'; jobId: string; urls: string[]; exportedAt?: string }
  | { state: 'failed'; jobId: string; detail: string }

async function call<T>(token: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`data portability ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`)
  return res.json() as Promise<T>
}

/**
 * Which resources this grant can be asked for repeatedly.
 *
 * A one-time grant produces exactly one archive and then needs the person back.
 * A time-based one can be re-asked, which is the difference between a source
 * that keeps up and a source that answered once — so the caller is told rather
 * than left to discover it on the second pass.
 */
export async function accessType(token: string): Promise<{ oneTime: string[]; timeBased: string[] }> {
  const r = await call<{ oneTimeResources?: string[]; timeBasedResources?: string[] }>(token, 'accessType:check', {})
  return { oneTime: r.oneTimeResources ?? [], timeBased: r.timeBasedResources ?? [] }
}

/** Ask Google to build an archive. Returns immediately with a job to poll. */
export async function initiate(token: string, resources: readonly string[] = TAKEOUT_RESOURCES): Promise<ArchiveJob> {
  const r = await call<{ archiveJobId?: string; accessType?: string }>(token, 'portabilityArchive:initiate', {
    resources: [...resources],
  })
  if (!r.archiveJobId) throw new Error('data portability: no job id came back')
  return {
    jobId: r.archiveJobId,
    ...(r.accessType ? { accessType: r.accessType } : {}),
    startedAt: new Date().toISOString(),
    resources: [...resources],
  }
}

/** Where a job has got to. Archives take minutes to hours, so this is polled. */
export async function state(token: string, jobId: string): Promise<ArchiveState> {
  try {
    const r = await call<{ state?: string; urls?: string[]; exportTime?: string }>(
      token,
      `archiveJobs/${jobId}/portabilityArchiveState`,
    )
    if (r.state === 'COMPLETE') {
      return { state: 'complete', jobId, urls: r.urls ?? [], ...(r.exportTime ? { exportedAt: r.exportTime } : {}) }
    }
    if (r.state === 'FAILED') return { state: 'failed', jobId, detail: 'Google reported the export failed' }
    return { state: 'in-progress', jobId }
  } catch (e) {
    return { state: 'failed', jobId, detail: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Give the grant back.
 *
 * Google requires this before a second archive on a one-time grant, and it is
 * the honest thing to call when someone disconnects: the authorization stops
 * existing rather than sitting unused.
 */
export const resetAuthorization = (token: string): Promise<unknown> => call(token, 'authorization:reset', {})

// ---------------------------------------------------------------------------
// The job, remembered between passes
// ---------------------------------------------------------------------------

const jobsPath = (userId?: string): string => {
  const base = process.env.RECALL_CACHE_DIR ?? '~/.recall'
  const root = base.startsWith('~') ? join(homedir(), base.slice(1)) : resolve(base)
  return userId ? join(root, 'users', `${userId}.takeout.json`) : join(root, 'takeout.json')
}

/**
 * An archive takes minutes to build, so a pass that asks for one cannot also
 * read it. The job is kept so the next pass can pick it up.
 */
export function rememberJob(job: ArchiveJob, userId?: string): void {
  const p = jobsPath(userId)
  mkdirSync(dirname(p), { recursive: true })
  const tmp = `${p}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(job, null, 2), { mode: 0o600 })
  renameSync(tmp, p)
}

export function pendingJob(userId?: string): ArchiveJob | null {
  const p = jobsPath(userId)
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, 'utf8')) as ArchiveJob } catch { return null }
}

export function clearJob(userId?: string): void {
  const p = jobsPath(userId)
  if (existsSync(p)) writeFileSync(p, 'null', { mode: 0o600 })
}

// ---------------------------------------------------------------------------
// Archive → claims
// ---------------------------------------------------------------------------

type Activity = { title?: string; header?: string; time?: string; subtitles?: { name?: string }[] }

/**
 * What someone orders, from their order and reservation activity.
 *
 * Counted rather than listed. "Ordered from X on Tuesday" is a receipt and
 * belongs to nobody but them; "orders from X most weeks" is a durable fact
 * about how they live, which is the only kind of thing worth a claim.
 */
export function orderFindings(activities: Activity[]): Finding[] {
  const byMerchant = new Map<string, number>()
  for (const a of activities) {
    // Google writes these as "Ordered <item> from <merchant>" or similar.
    const merchant = a.title?.match(/\bfrom\s+(.+?)\s*$/i)?.[1]?.trim() ?? a.subtitles?.[0]?.name?.trim()
    if (!merchant || merchant.length < 2 || merchant.length > 48) continue
    byMerchant.set(merchant, (byMerchant.get(merchant) ?? 0) + 1)
  }

  const out: Finding[] = []
  for (const [merchant, n] of [...byMerchant].sort((a, b) => b[1] - a[1]).slice(0, POLICY.google.keep)) {
    if (n < POLICY.google.minOrders) continue
    out.push({
      text: `Orders from ${merchant} regularly`,
      topic: 'interests',
      evidence: `${n} orders`,
      ref: 'https://myactivity.google.com',
      ...(n < POLICY.google.minOrders + 1 ? { weak: true } : {}),
    })
  }
  return out
}

/**
 * What someone watches, from YouTube activity.
 *
 * Channels, never videos. Which channels someone returns to says something
 * about what they are interested in; a list of what they watched last Tuesday
 * night is a different thing entirely, and not one a namespace should hold.
 */
export function watchFindings(activities: Activity[]): Finding[] {
  const byChannel = new Map<string, number>()
  for (const a of activities) {
    const channel = a.subtitles?.[0]?.name?.trim()
    if (!channel || channel.length < 2 || channel.length > 48) continue
    byChannel.set(channel, (byChannel.get(channel) ?? 0) + 1)
  }

  const out: Finding[] = []
  for (const [channel, n] of [...byChannel].sort((a, b) => b[1] - a[1]).slice(0, POLICY.google.keep)) {
    if (n < POLICY.google.minWatches) continue
    out.push({
      text: `Follows ${channel} on YouTube`,
      topic: 'interests',
      evidence: `${n} videos watched`,
      ref: 'https://www.youtube.com',
    })
  }
  return out
}

/**
 * Read an activity file out of an archive.
 *
 * Google ships these as JSON arrays inside a zip. Parsing the zip is the
 * caller's job; this understands one file's contents and nothing about where it
 * came from.
 */
export function parseActivity(json: string): Activity[] {
  try {
    const parsed = JSON.parse(json) as unknown
    return Array.isArray(parsed) ? (parsed as Activity[]) : []
  } catch {
    return []
  }
}
