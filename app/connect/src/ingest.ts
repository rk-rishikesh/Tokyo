/**
 * Event → claim → commit, and a record of every attempt.
 *
 * This is the thing that makes the demo honest: a connector does not "sync
 * memory". It proposes one claim, into a namespace the person owns, citing the
 * message it came from — and what lands is an ordinary commit with an ordinary
 * version bump. Skips are recorded too, because "we ignored 40 messages and
 * kept one" is the interesting half of the story.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { generateContentKey, type Source } from '@knowledge01/core'
import { Repository, RepoStore, repoPath } from '@knowledge01/repo'
import { isKnowledge, route, type ConnectorEvent } from './routing.js'

export type Outcome =
  | { status: 'committed'; namespace: string; claimId: string; commit: string; version: number; merged: boolean }
  | { status: 'proposed'; namespace: string; claimId: string; proposal: number }
  | { status: 'unchanged'; namespace: string; claimId: string }
  | { status: 'skipped'; reason: string }
  | { status: 'error'; reason: string }

export type ActivityEntry = {
  id: string
  at: string
  event: ConnectorEvent
  outcome: Outcome
  /** Filled in later when the commit reaches ENS, so the console can show the chain catching up. */
  published?: { at: string; version: number; contenthash: string; tx: string | null }
}

const root = (): string => {
  const base = process.env.RECALL_CACHE_DIR ?? '~/.recall'
  return base.startsWith('~') ? join(homedir(), base.slice(1)) : resolve(base)
}
/**
 * The activity log. Per user on a hosted site, because the feed shows what the
 * agent read — one visitor must never see another's sources or claims.
 */
const logPath = (userId?: string): string =>
  userId ? join(root(), 'users', `${userId}.activity.json`) : join(root(), 'connect-activity.json')

/** The activity log the console renders. Newest first, capped so it stays readable. */
export function readActivity(limit = 200, userId?: string): ActivityEntry[] {
  const p = logPath(userId)
  if (!existsSync(p)) return []
  try { return (JSON.parse(readFileSync(p, 'utf8')) as ActivityEntry[]).slice(0, limit) } catch { return [] }
}

function writeAll(all: ActivityEntry[], userId?: string): void {
  const p = logPath(userId)
  mkdirSync(dirname(p), { recursive: true })
  const tmp = `${p}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(all.slice(0, 500), null, 2), { mode: 0o600 })
  renameSync(tmp, p)
}

function appendActivity(entry: ActivityEntry, userId?: string): void {
  writeAll([entry, ...readActivity(999, userId)], userId)
}

/**
 * Stamp every unpublished entry of a namespace with the publish that carried it.
 * A publish is one transaction for many commits, so this marks all of them.
 */
export function markPublished(namespace: string, published: NonNullable<ActivityEntry['published']>, userId?: string): number {
  const all = readActivity(999, userId)
  let n = 0
  for (const e of all) {
    if (e.published) continue
    if (e.outcome.status === 'committed' && e.outcome.namespace === namespace) { e.published = published; n++ }
  }
  if (n) writeAll(all, userId)
  return n
}

export type IngestOptions = {
  /** ENS name the namespaces hang under: you.eth → decisions.you.eth. */
  owner: string
  /** Background passes log only what they wrote, not every skip they considered. */
  quiet?: boolean
  /** Create namespaces that do not exist yet. */
  create?: boolean
  personal?: boolean
  /** Do everything except write. */
  dryRun?: boolean
  /** Whose activity log this belongs to, on a hosted deployment. */
  userId?: string
}

/** Turn one marked event into a claim in a namespace the owner controls. */
export function ingest(event: ConnectorEvent, opts: IngestOptions): Outcome {
  const gate = isKnowledge(event)
  if (!gate.ok) {
    const outcome: Outcome = { status: 'skipped', reason: gate.reason! }
    if (!opts.dryRun && !opts.quiet) appendActivity({ id: `a_${Date.now().toString(36)}`, at: new Date().toISOString(), event, outcome }, opts.userId)
    return outcome
  }

  const r = route(event, { owner: opts.owner, ...(opts.personal ? { personal: true } : {}) })
  try {
    if (!RepoStore.exists(repoPath(r.namespace))) {
      if (!opts.create) throw new Error(`no namespace ${r.namespace} — start the service with --create, or run knowledge init ${r.namespace}`)
      if (opts.dryRun) {
        const outcome: Outcome = { status: 'committed', namespace: r.namespace, claimId: '(dry run)', commit: '(dry run)', version: 0, merged: false }
        return outcome
      }
      Repository.init(r.namespace, opts.owner, {
        contentKey: Buffer.from(generateContentKey()).toString('hex'),
        readers: 'key', kind: opts.personal ? 'personal' : 'organisation',
        title: r.topic.charAt(0).toUpperCase() + r.topic.slice(1),
        description: `${r.topic} for ${opts.owner}, written by connected applications and reviewed by their owner.`,
      })
    }
    const repo = Repository.open(r.namespace)
    // Act as the namespace owner: the connector writes on the owner's behalf,
    // and the person who marked the message is recorded on the claim's source.
    repo.actingAs = repo.policy.owner

    if (opts.dryRun) {
      return { status: 'committed', namespace: r.namespace, claimId: '(dry run)', commit: '(dry run)', version: repo.version(repo.refs.head), merged: false }
    }

    const source: Source = {
      type: event.connector, kind: event.sourceKind, name: event.sourceName,
      title: `${event.trigger}${event.context ? ` in ${event.context}` : ''} by ${event.actor}`,
      ...(event.ref ? { id: event.ref } : {}), excerpt: event.text,
    }
    const before = repo.index()
    const k = repo.add({ claim: event.text, subject: r.subject, topic: r.topic, type: r.type, confidence: r.confidence, sources: [source] })
    const merged = !!before[k.id]
    // Re-stating something already recorded, from a source already cited, changes
    // nothing — `mergeClaim` returns the existing claim untouched and there is no
    // diff to commit. That is the agent behaving correctly on a timer, not a
    // failure, so it gets its own status rather than being dressed up as an error.
    if (!repo.hasChanges()) {
      const outcome: Outcome = { status: 'unchanged', namespace: r.namespace, claimId: k.id }
      if (!opts.quiet) appendActivity({ id: `a_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, at: new Date().toISOString(), event, outcome }, opts.userId)
      return outcome
    }
    const commit = repo.commit(`${event.sourceName}: ${r.subject}`, { author: repo.policy.owner })
    const outcome: Outcome = { status: 'committed', namespace: r.namespace, claimId: k.id, commit: commit.id, version: repo.version(repo.refs.head), merged }
    appendActivity({ id: `a_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, at: new Date().toISOString(), event, outcome }, opts.userId)
    return outcome
  } catch (e) {
    const outcome: Outcome = { status: 'error', reason: e instanceof Error ? e.message : String(e) }
    if (!opts.dryRun) appendActivity({ id: `a_${Date.now().toString(36)}`, at: new Date().toISOString(), event, outcome }, opts.userId)
    return outcome
  }
}

/**
 * Whose namespaces the connected apps write into.
 *
 * `CONNECT_OWNER` wins; otherwise the owner is derived from KNOWLEDGE_NAMESPACE
 * (`conventions.recalltest.eth` → `recalltest.eth`). There is deliberately no
 * placeholder default: writing a person's real browsing into a namespace nobody
 * controls is worse than refusing to start, and a silent fallback is how that
 * happens — a shell missing one variable and the claims land somewhere else.
 */
export function connectOwner(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.CONNECT_OWNER?.trim()
  if (explicit) return explicit
  const parts = (env.KNOWLEDGE_NAMESPACE?.trim() ?? '').split('.').filter(Boolean)
  const derived = parts.length > 2 ? parts.slice(1).join('.') : parts.join('.')
  if (derived) return derived
  throw new Error('no owner configured — set CONNECT_OWNER=you.eth (or KNOWLEDGE_NAMESPACE) before connecting a workspace')
}
