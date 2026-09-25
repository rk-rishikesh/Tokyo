/**
 * The watcher: what makes this an agent rather than a viewer.
 *
 * A memory platform hooks the application's own loop — every turn, extraction
 * runs and memory updates, with nobody pressing anything. There is no such loop
 * to hook for a browser or a shell, so the equivalent is a poll: read the source
 * on an interval, compare against what is already known, and write only what
 * changed.
 *
 * Two things make that feel live rather than batch:
 *
 *   - A short window. Patterns over 90 days barely move, so nothing you do today
 *     shows up. The watcher looks at a recent window as well, which is where a
 *     new project or a new tool appears within minutes of you using it.
 *   - Diffing, not re-reading. Claims already in the namespace are not rewritten;
 *     only genuinely new patterns, or ones whose evidence grew enough to matter,
 *     produce a commit.
 *
 * It knows nothing about any particular source. Sources register themselves in
 * `sources.ts`; this iterates them.
 */
import { similarity } from '@recall/core'
import { Repository, RepoStore, repoPath } from '@recall/repo'
import { llmConfig } from './llm.js'
import { ingest, type Outcome } from './ingest.js'
import { subjectFor, topicFor } from './routing.js'
import { TOPIC_IDS } from './topics.js'
import { AGENT } from './policy.js'
import { readGrants } from './agent.js'
import { allUsers, type User } from './users.js'
import { liveToken } from './tokens.js'
import { publishShared } from './sharing.js'
import { reader, readSource, type ReadContext } from './registry.js'
import type { Provider } from './users.js'
import type { ActivityItem } from './workspaces.js'
// Importing for the side effect: this is what puts the sources in the registry.
import './sources.js'

/** A finding plus where it came from, before it becomes a claim. */
export type Observed = { item: ActivityItem; source: string; by: 'rules' | 'model'; weak?: boolean }

export type Tokens = Partial<Record<Provider, string>>

/**
 * Everything a source says right now.
 *
 * Returns nothing when a source is not connected or has nothing to read; a
 * source that *fails* is a different thing, reported by `readSource`, and the
 * callers that need to tell those apart use it directly.
 */
export async function readSourceNow(
  id: string,
  opts: { recentDays?: number; useModel?: boolean; tokens?: Tokens; allowLocalCredentials?: boolean } = {},
): Promise<Observed[]> {
  const ctx: ReadContext = {
    model: opts.useModel === false ? null : llmConfig(),
    ...(opts.recentDays !== undefined ? { recentDays: opts.recentDays } : {}),
    ...(opts.allowLocalCredentials ? { allowLocalCredentials: true } : {}),
    ...(opts.tokens?.[id as Provider] ? { token: opts.tokens[id as Provider]! } : {}),
  }
  const result = await readSource(id, ctx)
  if (!result.ok) return []
  const seen = new Set<string>()
  return result.findings
    .filter((f) => !seen.has(f.text) && seen.add(f.text))
    .map((f) => ({
      source: f.from,
      by: f.by,
      ...(f.weak ? { weak: true } : {}),
      item: {
        workspaceId: id,
        text: f.text,
        actor: 'you',
        context: f.host ?? f.from,
        ref: f.ref ?? '',
        marker: f.evidence,
      },
    }))
}

export type TickResult = {
  checked: number
  written: { text: string; outcome: Outcome; by: 'rules' | 'model' }[]
  at: string
  model: string | null
  /** Connections that could not be used this pass, so the UI can say why. */
  broken?: { provider: string; reason: string }[]
}

/**
 * One pass over every granted source: read, diff, write what is new.
 *
 * `ingest` already merges a claim that exists, so re-observing something costs
 * nothing and changes no version. That makes this safe to run on a timer.
 */
/**
 * Claims already in the namespaces this owner has, so a re-phrasing does not
 * become a second claim.
 *
 * A model does not repeat itself word for word: "Uses Linear for project
 * tracking" one pass, "Uses Linear for task management" the next. Content-derived
 * ids only catch exact matches, so on a timer that drift would accumulate
 * near-duplicates forever. This compares against what is already known and skips
 * anything that is merely a restatement.
 */
function knownClaims(owner: string): string[] {
  const out: string[] = []
  for (const topic of TOPIC_IDS) {
    const ns = `${topic}.${owner}`
    if (!RepoStore.exists(repoPath(ns))) continue
    try {
      const repo = Repository.open(ns)
      for (const k of Object.values(repo.headSnapshot(repo.refs.head))) out.push(k.claim)
    } catch { /* an unreadable namespace should not stop the pass */ }
  }
  return out
}

/**
 * A restatement of something already known, rather than a new fact.
 *
 * Two tests, because word overlap alone is too weak here: "Tracks work in
 * Linear" and "Uses Linear for project tracking" share one token and score
 * 0.14, but they are the same fact. Claims that resolve to the same subject in
 * the same topic are the same claim by construction — that is what `mergeClaim`
 * keys on — so the subject check catches the re-phrasings that the token check
 * cannot, and the token check still catches drift within one subject.
 */
export function isRestatement(text: string, known: string[]): boolean {
  if (known.some((k) => similarity(k, text) >= AGENT.restatementSimilarity)) return true
  const topic = topicFor(text)
  const subject = subjectFor(text, topic).toLowerCase()
  return known.some((k) => {
    const kt = topicFor(k)
    return kt === topic && subjectFor(k, kt).toLowerCase() === subject
  })
}

export async function tick(opts: { owner: string; recentDays?: number; useModel?: boolean; userId?: string; tokens?: Tokens; allowLocalCredentials?: boolean; wallet?: string }): Promise<TickResult> {
  const grants = readGrants(opts.userId).filter((g) => !g.revokedAt)
  // Someone running this on their own machine has no wallet session; their
  // wallet is the one they name, or the one that owns their ENS name.
  const wallet = opts.wallet ?? (opts.allowLocalCredentials && grants.some((g) => g.workspaceId === 'ethereum') ? await localWallet(opts.owner) : undefined)
  const written: TickResult['written'] = []
  const broken: NonNullable<TickResult['broken']> = []
  const known = knownClaims(opts.owner)
  let checked = 0
  for (const g of grants) {
    const ctx: ReadContext = {
      model: opts.useModel === false ? null : llmConfig(),
      ...(opts.recentDays !== undefined ? { recentDays: opts.recentDays } : {}),
      ...(opts.allowLocalCredentials ? { allowLocalCredentials: true } : {}),
      ...(opts.tokens?.[g.workspaceId as Provider] ? { token: opts.tokens[g.workspaceId as Provider]! } : {}),
      ...(opts.userId ? { userId: opts.userId } : {}),
      ...(wallet ? { wallet } : {}),
    }
    // A grant can outlive the source it names — `google-calendar` and `gmail`
    // became one `google` source, and old grants still pointed at the dead ids.
    // That is a stale record, not a broken connection, so it is skipped rather
    // than reported as a failure the person could act on.
    if (!reader(g.workspaceId)) continue
    const result = await readSource(g.workspaceId, ctx)
    // A source that fails has to say so. The old dispatch chain wrapped every
    // branch in one catch, so a connected source that threw reported the same
    // thing as a quiet one — which is exactly how an expired Granola token
    // looked like a week with no meetings.
    if (!result.ok) {
      if (result.reason !== 'not-connected') broken.push({ provider: g.workspaceId, reason: result.detail ?? result.reason })
      continue
    }
    const seen = new Set<string>()
    const observed: Observed[] = result.findings
      .filter((f) => !seen.has(f.text) && seen.add(f.text))
      .map((f) => ({
        source: f.from,
        by: f.by,
        ...(f.weak ? { weak: true } : {}),
        item: { workspaceId: g.workspaceId, text: f.text, actor: 'you', context: f.host ?? f.from, ref: f.ref ?? '', marker: f.evidence },
      }))
    for (const o of observed) {
      checked++
      // Rules are deterministic, so their output is already stable; only model
      // output drifts in wording and needs this. `known` grows as the pass runs,
      // so the comparison covers claims accepted moments ago as well as what the
      // namespaces already held — one extraction commonly returns "Tracks work
      // in Linear" and "Uses Linear for project tracking" together, and rules
      // run before the model, so a grounded claim always wins the subject.
      if (o.by === 'model' && isRestatement(o.item.text, known)) continue
      const outcome = ingest({
        connector: g.workspaceId, sourceName: o.source, sourceKind: 'application',
        text: o.item.text, actor: 'you', ref: o.item.ref, trigger: o.item.marker,
        context: o.item.context, by: o.by, ...(o.weak ? { weak: true } : {}), at: new Date().toISOString(),
      }, { owner: opts.owner, create: true, quiet: true, ...(opts.userId ? { userId: opts.userId } : {}) })
      // Only report things that actually changed the namespace — but learn the
      // wording either way. A claim the namespace already held is still a claim
      // later extractions should recognise as a restatement rather than re-add,
      // and so is a rules claim, which is what the model tends to re-phrase.
      if (outcome.status === 'committed') written.push({ text: o.item.text, outcome, by: o.by })
      if (outcome.status === 'committed' || outcome.status === 'unchanged') known.push(o.item.text)
    }
  }
  // Namespaces an agent has been granted are re-published as they change, so a
  // grant is to the memory rather than to the version that existed when it was
  // made. A publish failure must not lose the claims, which are already committed.
  const touched = written.flatMap((w) => (w.outcome.status === 'committed' ? [w.outcome.namespace] : []))
  if (touched.length) await publishShared(touched).catch(() => [])
  const result: TickResult = { checked, written, at: new Date().toISOString(), model: llmConfig()?.model ?? null }
  return broken.length ? { ...result, broken } : result
}


async function localWallet(owner: string): Promise<string | undefined> {
  const named = process.env.CONNECT_WALLET_ADDRESS?.trim()
  if (named) return named
  try {
    const { createPublicClient, http } = await import('viem')
    const { sepolia } = await import('viem/chains')
    const { findOwner } = await import('@recall/core')
    const client = createPublicClient({ chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL?.trim() || 'https://ethereum-sepolia-rpc.publicnode.com') })
    const a = await findOwner(client as never, owner.split('.').slice(-2).join('.'))
    return BigInt(a) === 0n ? undefined : a
  } catch { return undefined }
}

/**
 * One pass for one signed-in person.
 *
 * Their namespaces, their grants, their tokens — nothing here touches the
 * machine the server runs on, which is the difference between a demo and a site
 * other people can use. Local sources (browser, editor, shell) are simply not
 * reachable for a visitor, and their grants never exist, so they never run.
 */
export async function tickUser(user: User, opts: { recentDays?: number; useModel?: boolean } = {}): Promise<TickResult> {
  // `liveToken` rather than the stored one: access tokens expire within hours,
  // and a reader handed an expired credential gets a 401, returns nothing, and
  // reports a quiet week rather than a dead connection.
  const tokens: Partial<Record<'github' | 'google' | 'linear' | 'granola', string>> = {}
  const broken: TickResult['broken'] = []
  for (const p of ['github', 'google', 'linear', 'granola'] as const) {
    const state = await liveToken(user.id, p)
    if (state.ok) tokens[p] = state.token
    else if (state.reason !== 'not-connected') broken.push({ provider: p, reason: state.detail ?? state.reason })
  }
  // Never `allowLocalCredentials` here: a hosted visitor must read their own
  // accounts or nothing at all.
  const result = await tick({ ...opts, owner: user.namespace, userId: user.id, tokens, ...(user.wallet ? { wallet: user.wallet.address } : {}) })
  const all = [...broken, ...(result.broken ?? [])]
  return all.length ? { ...result, broken: all } : result
}

/** Every connected person, one pass each. What a scheduled job calls. */
export async function tickAll(opts: { recentDays?: number; useModel?: boolean } = {}): Promise<{ user: string; result: TickResult }[]> {
  const out: { user: string; result: TickResult }[] = []
  for (const u of allUsers()) {
    // One person's provider being down must not stop everyone else's pass.
    try { out.push({ user: u.login, result: await tickUser(u, opts) }) }
    catch (e) { console.warn(`tick failed for ${u.login}: ${e instanceof Error ? e.message : String(e)}`) }
  }
  return out
}
