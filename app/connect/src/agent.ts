/**
 * The agent: it watches connected workspaces and keeps memory up to date.
 *
 * The watcher deliberately does *not* act — no booking, no replying, no
 * sending. It reads sources and writes claims, and that is all it can do.
 * Every write is an ordinary commit in a namespace under your name, citing the
 * source it came from.
 *
 * Acting is a separate thing this product can do, through chat, and it asks
 * first. Keeping the two apart matters: an agent that watches everything you do
 * is tolerable precisely because it cannot act on what it sees, and one that
 * acts is tolerable because you asked it to in the moment. Collapsing them
 * would give you a thing that does both silently.
 *
 * Grants live next to the repositories, so revoking is a local act with no
 * server to ask.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { chromeProfiles, findings as chromeFindings, readHistory } from './chrome.js'
import { editorFindings, editorProfiles, projectStack, shellFindings, shellHistoryPath } from './local-sources.js'
import { ingest, type Outcome } from './ingest.js'
import { workspace, WORKSPACES, type ActivityItem, type Grant } from './workspaces.js'
import type { ConnectorEvent } from './routing.js'
import { cacheRoot } from './cacheRoot.js'

const root = (): string => {
  return cacheRoot()
}
/**
 * Where a person's grants live.
 *
 * Without a user id this is the single-machine file the local demo has always
 * used. With one it is that person's own file, because on a hosted site two
 * visitors' grants must never be the same list — the agent would otherwise read
 * one person's sources into another person's namespace.
 */
const grantsPath = (userId?: string): string =>
  userId ? join(root(), 'users', `${userId}.grants.json`) : join(root(), 'agent-grants.json')

/**
 * Everything a source has to say right now, read live from disk.
 *
 * Cached per process: re-reading a 40MB history database on every click would
 * make the UI crawl, and the answer does not change between clicks.
 */
const cache = new Map<string, ActivityItem[]>()

function readSource(id: string): ActivityItem[] {
  const hit = cache.get(id)
  if (hit) return hit
  let items: ActivityItem[] = []
  try {
    if (id === 'chrome') {
      const profile = chromeProfiles()[0]
      if (profile) items = chromeFindings(readHistory(profile.path, { days: 90 })).map((f) => ({
        workspaceId: id, text: f.text, actor: 'you', context: f.host, ref: `https://${f.host}`, marker: f.evidence,
      }))
    } else if (id === 'editor') {
      const profile = editorProfiles()[0]
      if (profile) {
        const found = editorFindings(profile.storage, profile.name)
        // The stack of each project you actually have open, from its own manifest.
        const stacks = found.flatMap((f) => (f.ref ? projectStack(f.ref) : []))
        items = [...found, ...stacks].map((f) => ({
          workspaceId: id, text: f.text, actor: 'you', context: profile.name, ref: f.ref ?? profile.storage, marker: f.evidence,
        }))
      }
    } else if (id === 'shell') {
      const path = shellHistoryPath()
      if (path) items = shellFindings(path).map((f) => ({
        workspaceId: id, text: f.text, actor: 'you', context: 'shell', ref: path, marker: f.evidence,
      }))
    }
  } catch { items = [] }
  // Deduplicate: two sources often notice the same tool, and the claim id would
  // merge them anyway — better to show it once per source read.
  const seen = new Set<string>()
  items = items.filter((i) => !seen.has(i.text) && seen.add(i.text))
  cache.set(id, items)
  return items
}

/** Drop the cache so the next read sees fresh data (after a re-grant, say). */
export const refreshSources = (): void => cache.clear()

export function readGrants(userId?: string): Grant[] {
  const p = grantsPath(userId)
  if (!existsSync(p)) return []
  try { return JSON.parse(readFileSync(p, 'utf8')) as Grant[] } catch { return [] }
}

function writeGrants(g: Grant[], userId?: string): void {
  const p = grantsPath(userId)
  mkdirSync(dirname(p), { recursive: true })
  const tmp = `${p}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(g, null, 2), { mode: 0o600 })
  renameSync(tmp, p)
}

/** Record that a pass read this source, and what it found. */
export function notePass(workspaceId: string, found: number, userId?: string): void {
  const all = readGrants(userId)
  const g = all.find((x) => x.workspaceId === workspaceId && !x.revokedAt)
  if (!g) return
  g.lastPass = { at: new Date().toISOString(), found }
  writeGrants(all, userId)
}

export const grantFor = (workspaceId: string, userId?: string): Grant | undefined =>
  readGrants(userId).find((g) => g.workspaceId === workspaceId && !g.revokedAt)

/** Grant the agent read access to a workspace. */
export function grant(workspaceId: string, userId?: string): Grant {
  const def = workspace(workspaceId)
  if (!def) throw new Error(`unknown workspace ${workspaceId}`)
  const all = readGrants(userId).filter((g) => g.workspaceId !== workspaceId)
  const g: Grant = { workspaceId, account: def.account, scopes: def.scopes.map((s) => s.id), grantedAt: new Date().toISOString(), cursor: 0 }
  writeGrants([...all, g], userId)
  return g
}

/**
 * Revoke access. The claims it already wrote stay — they are yours, and they
 * keep their attribution. That is the opposite of a vendor deleting your memory
 * when you leave.
 */
export function revoke(workspaceId: string, userId?: string): Grant | undefined {
  const all = readGrants(userId)
  const g = all.find((x) => x.workspaceId === workspaceId && !x.revokedAt)
  if (!g) return undefined
  g.revokedAt = new Date().toISOString()
  writeGrants(all, userId)
  return g
}

function advance(workspaceId: string, cursor: number, userId?: string): void {
  const all = readGrants(userId)
  const g = all.find((x) => x.workspaceId === workspaceId && !x.revokedAt)
  if (g) { g.cursor = cursor; writeGrants(all, userId) }
}

const toEvent = (item: ActivityItem): ConnectorEvent | null => {
  const def = workspace(item.workspaceId)
  if (!def) return null
  return {
    connector: def.id, sourceName: def.name, sourceKind: def.kind, text: item.text,
    actor: item.actor, ref: item.ref, trigger: item.marker, context: item.context,
    at: new Date().toISOString(),
  }
}

export type Observation = { item: ActivityItem; workspace: string; outcome: Outcome }

/**
 * Let the agent read the next `count` items from every connected workspace.
 *
 * Returns what it saw and what it did, including the items it decided were not
 * knowledge — an agent that keeps everything is the failure mode, so the skips
 * are part of the output, not hidden.
 */
export function observe(opts: { owner: string; count?: number; workspaceId?: string }): Observation[] {
  const grants = readGrants().filter((g) => !g.revokedAt && (!opts.workspaceId || g.workspaceId === opts.workspaceId))
  const out: Observation[] = []
  for (const g of grants) {
    const items = readSource(g.workspaceId)
    const take = Math.min(opts.count ?? 1, Math.max(0, items.length - g.cursor))
    for (let i = 0; i < take; i++) {
      const item = items[g.cursor + i]
      if (!item) break
      const event = toEvent(item)
      if (!event) continue
      out.push({ item, workspace: g.workspaceId, outcome: ingest(event, { owner: opts.owner, create: true }) })
    }
    if (take > 0) advance(g.workspaceId, g.cursor + take)
  }
  return out
}

/** How much of each workspace the agent has read — so the UI can show it catching up. */
export function progress(userId?: string): { workspaceId: string; name: string; seen: number; total: number; connected: boolean; revoked: boolean }[] {
  const grants = readGrants(userId)
  return WORKSPACES.map((w) => {
    const g = grants.find((x) => x.workspaceId === w.id)
    return { workspaceId: w.id, name: w.name, seen: g?.cursor ?? 0, total: readSource(w.id).length, connected: !!g && !g.revokedAt, revoked: !!g?.revokedAt }
  })
}
