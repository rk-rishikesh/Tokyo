/**
 * Read-only view of a knowledge namespace for the explorer.
 *
 * Source of truth is what `knowledge push` published: the namespace's ENS
 * `contenthash` → Refs object → commit objects on IPFS. Public namespaces are
 * plaintext; private ones are decrypted with the namespace key
 * (RECALL_CONTENT_KEY, or the key in a local repository for the same name).
 * The explorer never writes.
 *
 * When nothing is published yet but a local repository exists on this machine,
 * the explorer shows that instead and says so — useful while developing, and
 * honest about what is and is not on chain.
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  decodeObject, diffSnapshots, log, mergeBase, searchSnapshot, validateCommit, verifyCommit, why,
  getContenthash,
  sourceKind,
  type Commit, type Knowledge, type Lookup, type Proposal, type Refs, type Snapshot, type SourceConnection, type SourceKind,
} from '@knowledge01/core'
import { RepoStore, repoPath, reposDir } from '@knowledge01/repo'
import { createStorage, decodeContenthash } from '@knowledge01/storage'
import { serverClient } from './chain'

export type RepoView = {
  namespace: string
  identity: string
  source: 'ens' | 'local'
  contenthash: string | null
  refsRef: string | null
  refs: Refs
  commits: Record<string, Commit>
  lookup: Lookup
  /** Where an object can be seen hosted, or null when it is not published. */
  gatewayUrl: (cid: string) => string | null
  /** Local commits that the published refs do not carry yet (PRD W4). */
  pendingCommits: number
}

/** Namespaces the explorer lists: configured, plus any repository on this machine. */
/**
 * The live namespaces on ENS. Listed in code because NEXT_PUBLIC_ variables are
 * fixed at build time: a deploy built with a stale value showed a stale sidebar.
 * The variable still adds names; it can no longer take these away.
 */
export const LIVE_NAMESPACES = [
  'cancer-research.eth', 'treasury.eth', 'signals.treasury.eth', 'personal.eth',
  'treasury.kestrel.eth', 'watch.kestrel.eth', 'portfolio.kestrel.eth',
  'notes.rishhtokyo.eth', 'projects.rishhtokyo.eth', 'conventions.acme.eth',
]

export function knownNamespaces(): string[] {
  const configured = [...LIVE_NAMESPACES, ...(process.env.NEXT_PUBLIC_KNOWLEDGE_NAMESPACES ?? '').split(',').map((s) => s.trim()).filter(Boolean)]
  const dir = reposDir()
  const local = existsSync(dir) ? readdirSync(dir).filter((d) => RepoStore.exists(join(dir, d))) : []
  return [...new Set([...configured, ...local])]
}

function contentKeyFor(namespace: string): Uint8Array | null {
  const local = RepoStore.exists(repoPath(namespace)) ? RepoStore.open(repoPath(namespace)).readConfig().contentKey : undefined
  const hex = local ?? process.env.RECALL_CONTENT_KEY
  if (!hex) return null
  return Uint8Array.from(Buffer.from(hex.replace(/^0x/, ''), 'hex'))
}

/** Try plaintext first (public namespaces); fall back to the key. */
async function readObject(storage: ReturnType<typeof createStorage>, ref: { kind: 'ipfs' | 'swarm'; ref: string }, key: Uint8Array | null): Promise<unknown> {
  const raw = await storage.get(ref, { plaintext: true })
  try {
    const text = new TextDecoder().decode(raw)
    if (text.trimStart().startsWith('{')) return JSON.parse(text)
  } catch { /* not plaintext JSON */ }
  if (!key) throw new Error('this namespace is private and the explorer has no key for it (set RECALL_CONTENT_KEY)')
  return decodeObject(await storage.get(ref, { contentKey: key }))
}

function gateway(): string | null {
  const g = process.env.PINATA_GATEWAY?.replace(/^https?:\/\//, '').replace(/\/$/, '')
  return g ? `https://${g}` : null
}

// Objects are content-addressed, so a fetched commit never changes: cache by CID.
const objectCache = new Map<string, Commit>()

async function loadPublished(namespace: string): Promise<RepoView | null> {
  const ch = await getContenthash(serverClient(), namespace).catch(() => '0x' as const)
  if (!ch || ch === '0x') return null
  const key = contentKeyFor(namespace)
  const storage = createStorage()
  const refsRef = storage.fromContenthash(ch)
  const refs = (await readObject(storage, refsRef, key)) as Refs
  if (refs.kind !== 'refs') throw new Error('contenthash does not point at a refs object')

  const commits: Record<string, Commit> = {}
  await Promise.all(Object.entries(refs.objects).map(async ([id, cid]) => {
    let c = objectCache.get(cid)
    if (!c) {
      c = (await readObject(storage, { kind: storage.kind, ref: cid }, key)) as Commit
      validateCommit(c)
      if (c.id !== id || !verifyCommit(c)) throw new Error(`object ${cid} is not commit ${id}`)
      objectCache.set(cid, c)
    }
    commits[id] = c
  }))

  const identity = refs.policy.owner
  const host = gateway()
  // If this machine also holds the repository, count what it has not published yet.
  const local = RepoStore.exists(repoPath(namespace)) ? RepoStore.open(repoPath(namespace)) : null
  const pendingCommits = local ? local.allCommitIds().filter((id) => !(id in refs.objects)).length : 0
  return {
    namespace, identity, source: 'ens', contenthash: ch, refsRef: refsRef.ref, refs, commits,
    lookup: (id) => commits[id],
    gatewayUrl: (cid) => (host ? `${host}/ipfs/${cid}` : null),
    pendingCommits,
  }
}

function loadLocal(namespace: string): RepoView | null {
  if (!RepoStore.exists(repoPath(namespace))) return null
  const store = RepoStore.open(repoPath(namespace))
  const refs = store.readRefs()
  const commits: Record<string, Commit> = {}
  for (const id of store.allCommitIds()) { const c = store.getCommit(id); if (c) commits[id] = c }
  const host = gateway()
  return {
    namespace, identity: refs.policy.owner, source: 'local', contenthash: null, refsRef: null, refs, commits,
    lookup: (id) => commits[id],
    gatewayUrl: (cid) => (host && cid ? `${host}/ipfs/${cid}` : null),
    pendingCommits: Object.keys(commits).length,
  }
}

export async function loadRepo(namespace: string): Promise<RepoView | null> {
  return (await loadPublished(namespace)) ?? loadLocal(namespace)
}

// ---- derived views, all pure over the loaded objects ----

export const headOf = (v: RepoView, branch: string): Commit | undefined => {
  const id = v.refs.branches[branch]
  return id ? v.commits[id] : undefined
}
export const snapshotOf = (v: RepoView, branch: string): Snapshot => headOf(v, branch)?.snapshot ?? {}
export const defaultBranch = (v: RepoView): string => (v.refs.head in v.refs.branches ? v.refs.head : Object.keys(v.refs.branches)[0] ?? 'main')

export function resolveRef(v: RepoView, ref: string): Commit | undefined {
  if (ref in v.refs.branches) return v.commits[v.refs.branches[ref]!]
  if (ref === 'HEAD') return headOf(v, defaultBranch(v))
  if (v.commits[ref]) return v.commits[ref]
  const matches = Object.keys(v.commits).filter((id) => id.startsWith(ref))
  return matches.length === 1 ? v.commits[matches[0]!] : undefined
}

export const logOf = (v: RepoView, branch: string, limit = 100): Commit[] => {
  const head = v.refs.branches[branch]
  return head ? log(v.lookup, head, limit) : []
}

export function diffRefs(v: RepoView, from: string, to: string) {
  const a = resolveRef(v, from)
  const b = resolveRef(v, to)
  if (!a || !b) return null
  return { from: a, to: b, diff: diffSnapshots(a.snapshot, b.snapshot) }
}

export function whyOf(v: RepoView, branch: string, memoryId: string) {
  const head = v.refs.branches[branch]
  return head ? why(v.lookup, head, memoryId) : undefined
}

export function searchOf(v: RepoView, branch: string, q: string, topic?: string) {
  return searchSnapshot(snapshotOf(v, branch), q, { ...(topic ? { topic } : {}), limit: 100 })
}

/** Version number of a branch: commits on its first-parent line. */
export const versionOf = (v: RepoView, branch: string): number => {
  const head = v.refs.branches[branch]
  return head ? log(v.lookup, head, 100_000).length : 0
}

/** Resolve "v42" as well as branches and ids. */
export function resolveVersion(v: RepoView, ref: string): Commit | undefined {
  const m = /^v(\d+)$/.exec(ref)
  if (!m) return resolveRef(v, ref)
  const line = logOf(v, defaultBranch(v), 100_000)
  return line[line.length - Number(m[1])]
}

export const proposalsOf = (v: RepoView): Proposal[] => Object.values(v.refs.proposals ?? {}).sort((a, b) => b.number - a.number)
export const openProposals = (v: RepoView): Proposal[] => proposalsOf(v).filter((p) => !['committed', 'rejected'].includes(p.status))

/** Who has contributed and reviewed, from the objects themselves and the commits. */
export function contributorsOf(v: RepoView, branch: string): { name: string; contributed: number; reviewed: number; commits: number; last: string }[] {
  const by = new Map<string, { contributed: number; reviewed: number; commits: number; last: string }>()
  const get = (n: string) => by.get(n) ?? { contributed: 0, reviewed: 0, commits: 0, last: '' }
  for (const k of Object.values(snapshotOf(v, branch)) as Knowledge[]) {
    const c = get(k.contributor); c.contributed++; by.set(k.contributor, c)
    for (const r of k.reviewers) { const e = get(r); e.reviewed++; by.set(r, e) }
  }
  for (const c of Object.values(v.commits)) { const e = get(c.author); e.commits++; if (c.timestamp > e.last) e.last = c.timestamp; by.set(c.author, e) }
  return [...by.entries()].map(([name, e]) => ({ name, ...e })).sort((a, b) => b.contributed + b.reviewed - (a.contributed + a.reviewed))
}

/** Objects grouped by topic, then subject. */
export function outline(snapshot: Snapshot): { topic: string; subjects: { subject: string; items: Knowledge[] }[] }[] {
  const topics = new Map<string, Map<string, Knowledge[]>>()
  for (const k of Object.values(snapshot)) {
    const t = k.topic ?? ''; const s = k.subject ?? ''
    const m = topics.get(t) ?? new Map<string, Knowledge[]>(); m.set(s, [...(m.get(s) ?? []), k]); topics.set(t, m)
  }
  return [...topics.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([topic, m]) => ({ topic, subjects: [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([subject, items]) => ({ subject, items })) }))
}

/** Commits on `branch` not on `base`, and vice versa. */
export function aheadBehind(v: RepoView, branch: string, base: string): { ahead: number; behind: number; base: string | null } {
  const a = v.refs.branches[branch]; const b = v.refs.branches[base]
  if (!a || !b) return { ahead: 0, behind: 0, base: null }
  if (a === b) return { ahead: 0, behind: 0, base: a }
  const mb = mergeBase(v.lookup, a, b)
  const count = (from: string) => { let n = 0; for (const c of log(v.lookup, from, 10_000)) { if (c.id === mb) break; n++ } return n }
  return { ahead: count(a), behind: count(b), base: mb ?? null }
}

/** The explorer's short-id helper, shared with links. */
export const short = (id: string) => id.slice(0, 7)

// ---- network-wide views (many namespaces) ----

export async function loadAll(): Promise<RepoView[]> {
  const views = await Promise.all(knownNamespaces().map((n) => loadRepo(n).catch(() => null)))
  return views.filter((v): v is RepoView => !!v)
}

/** Nest namespaces by their `parent` field, falling back to the name suffix. */
/**
 * A namespace, or a name that only groups namespaces.
 *
 * `view` is null for a parent name that holds no claims of its own —
 * rishhtokyo.eth, whose memory is all in notes.rishhtokyo.eth and
 * projects.rishhtokyo.eth. Without the group row those children were listed at
 * the top level, as if they had nothing to do with each other.
 */
export type Tree = { name: string; view: RepoView | null; children: Tree[] }

export function tree(views: RepoView[]): Tree[] {
  const byName = new Map<string, Tree>(views.map((v) => [v.namespace, { name: v.namespace, view: v, children: [] }]))
  const parentOf = (name: string, explicit?: string): string | undefined => {
    if (explicit) return explicit
    const p = name.split('.').slice(1).join('.')
    // A parent is a real name (label.eth or deeper), never the TLD itself.
    return p.includes('.') ? p : undefined
  }
  // Group names for parents that are not namespaces but have two or more children,
  // or one child whose parent is plainly the owner's root name.
  const wanted = new Map<string, number>()
  for (const v of views) {
    const p = parentOf(v.namespace, v.refs.parent)
    if (p && !byName.has(p)) wanted.set(p, (wanted.get(p) ?? 0) + 1)
  }
  for (const [name] of wanted) byName.set(name, { name, view: null, children: [] })

  const roots: Tree[] = []
  for (const node of byName.values()) {
    const p = node.view ? parentOf(node.name, node.view.refs.parent) : parentOf(node.name)
    if (p && byName.has(p)) byName.get(p)!.children.push(node); else roots.push(node)
  }
  const sort = (ts: Tree[]) => { ts.sort((a, b) => a.name.localeCompare(b.name)); ts.forEach((t) => sort(t.children)) }
  sort(roots)
  return roots
}

export type SourceRow = { id: string; name: string; kind: SourceKind; description?: string; status: SourceConnection['status']; namespaces: string[]; objects: number; connectedAt: string }

/** Every connected source across the network, plus sources that are cited but never connected. */
export function sourcesAcross(views: RepoView[]): SourceRow[] {
  const rows = new Map<string, SourceRow>()
  for (const v of views) {
    const snap = snapshotOf(v, defaultBranch(v))
    for (const c of Object.values(v.refs.sources ?? {})) {
      const key = c.name.toLowerCase()
      const row = rows.get(key) ?? { id: c.id, name: c.name, kind: c.kind, ...(c.description ? { description: c.description } : {}), status: c.status, namespaces: [], objects: 0, connectedAt: c.connectedAt }
      row.namespaces.push(v.namespace)
      row.objects += Object.values(snap).filter((k) => k.sources.some((s) => (s.name ?? '').toLowerCase() === key)).length
      rows.set(key, row)
    }
    for (const k of Object.values(snap)) for (const s of k.sources) {
      if (!s.name) continue
      const key = s.name.toLowerCase()
      if (rows.has(key)) continue
      rows.set(key, { id: key.replace(/[^a-z0-9]+/g, '-'), name: s.name, kind: sourceKind(s), status: 'connected', namespaces: [v.namespace], objects: 1, connectedAt: k.created_at })
    }
  }
  return [...rows.values()].sort((a, b) => b.objects - a.objects)
}

/** Open proposals across the network, newest first. */
export function pendingAcross(views: RepoView[]): { view: RepoView; proposal: Proposal }[] {
  return views.flatMap((view) => openProposals(view).map((proposal) => ({ view, proposal }))).sort((a, b) => b.proposal.createdAt.localeCompare(a.proposal.createdAt))
}
export function proposalsAcross(views: RepoView[]): { view: RepoView; proposal: Proposal }[] {
  return views.flatMap((view) => proposalsOf(view).map((proposal) => ({ view, proposal }))).sort((a, b) => b.proposal.updatedAt.localeCompare(a.proposal.updatedAt))
}

/** Which version of the default branch a commit is. */
export function versionNumber(v: RepoView, commitId: string): number | undefined {
  const line = logOf(v, defaultBranch(v), 100_000)
  const i = line.findIndex((c) => c.id === commitId)
  return i === -1 ? undefined : line.length - i
}

/** Supersession chain around one claim: what it replaced (walking history), and what replaced it. */
export function supersessionOf(v: RepoView, branch: string, id: string): { replaced: Knowledge[]; replacedBy: Knowledge[] } {
  const head = v.refs.branches[branch]
  const all = new Map<string, Knowledge>()
  if (head) for (const c of log(v.lookup, head, 100_000)) for (const k of Object.values(c.snapshot)) if (!all.has(k.id)) all.set(k.id, k)
  const me = all.get(id)
  const replaced: Knowledge[] = []
  let cur = me?.supersedes
  while (cur && all.has(cur) && replaced.length < 20) { replaced.push(all.get(cur)!); cur = all.get(cur)!.supersedes }
  const replacedBy = [...all.values()].filter((k) => k.supersedes === id)
  return { replaced, replacedBy }
}

/** A claim present in history but not in the current snapshot: retired (superseded, removed or reverted). */
export function retiredClaim(v: RepoView, branch: string, id: string): Knowledge | undefined {
  const head = v.refs.branches[branch]
  if (!head) return undefined
  for (const c of log(v.lookup, head, 100_000)) if (c.snapshot[id]) return c.snapshot[id]
  return undefined
}
