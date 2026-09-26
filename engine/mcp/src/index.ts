/**
 * Knowledge MCP server — `knowledge_*` tools over local namespaces (PRD §20).
 *
 *   knowledge_resolve  knowledge_search  knowledge_get      knowledge_sources
 *   knowledge_history  knowledge_diff    knowledge_status   knowledge_findings
 *   knowledge_propose  knowledge_review  knowledge_land     knowledge_observe
 *   knowledge_commit   knowledge_branch  knowledge_merge    knowledge_revert
 *   knowledge_pull     knowledge_push
 *
 * An agent names the namespace on every call (cancer-research.eth, alice.eth…), so one
 * server composes many namespaces (PRD §26–27). Everything but pull/push is
 * local. The server never holds a funded wallet: `knowledge_push` refuses
 * unless PRIVATE_KEY is present in this process, and pull needs no key at all
 * for public namespaces.
 *
 * Configure:
 *   KNOWLEDGE_AGENT      identity the agent acts as (contributor / reviewer name). Default: "reader" on a fresh local copy.
 *   KNOWLEDGE_NAMESPACE  default namespace when a call omits one.
 *   KNOWLEDGE_READER_KEY private key a sealed namespace granted access to (e.g. one bought over
 *                        x402). Used only to open grants in knowledge_read; it never signs a transaction.
 *   PINATA_GATEWAY       required: the dedicated gateway reads are fetched through.
 *
 * Install:  claude mcp add knowledge -- node <path>/engine/mcp/dist/knowledge-mcp.mjs
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createPublicClient, createWalletClient, http, type PublicClient, type WalletClient } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import { normalisePrivateKey, onchainRoles, policyMembers, renderFindings, searchSnapshot, shortId, type Resolution, type Source } from '@knowledge01/core'
import { AccessDenied, EnsPointer, ensNetwork, NotPublished, Remote, Repository, RepoStore, repoPath, reposDir, resolveNamespace } from '@knowledge01/repo'
import { createStorage } from '@knowledge01/storage'
import { formatConflicts, formatDiff, formatHits, formatKnowledge, formatLog, formatProposal, formatWhy, notice } from './format.js'

const RPC = process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'
const AGENT = process.env.KNOWLEDGE_AGENT

const local = () => { const dir = reposDir(); return existsSync(dir) ? readdirSync(dir).filter((d) => RepoStore.exists(join(dir, d))) : [] }

function repo(namespace?: string): Repository {
  const ns = namespace ?? process.env.KNOWLEDGE_NAMESPACE ?? (local().length === 1 ? local()[0] : undefined)
  if (!ns) throw new Error(`name a namespace (local: ${local().join(', ') || 'none'}) or set KNOWLEDGE_NAMESPACE`)
  if (!RepoStore.exists(repoPath(ns))) {
    // Unknown locally: create an empty public repository so `knowledge_pull` can fetch it.
    Repository.init(ns, AGENT ?? 'reader')
  }
  const r = Repository.open(ns)
  if (AGENT) r.actingAs = AGENT
  return r
}

function remote(r: Repository): Remote {
  const pc = createPublicClient({ chain: sepolia, transport: http(RPC) }) as PublicClient
  const pk = normalisePrivateKey(process.env.PRIVATE_KEY)
  const wallet: WalletClient | undefined = pk ? (createWalletClient({ account: privateKeyToAccount(pk), chain: sepolia, transport: http(RPC) }) as WalletClient) : undefined
  return new Remote(r, createStorage(), new EnsPointer(r.namespace, pc, wallet))
}

/** Who may publish, read live from the namespace's resolver: the policy says who reviews, ENS decides who publishes. */
async function publishers(r: Repository): Promise<string> {
  try {
    const { resolver, roles } = await onchainRoles(createPublicClient({ chain: sepolia, transport: http(RPC) }) as PublicClient, r.namespace, policyMembers(r.policy))
    if (!resolver) return 'on ENS: not registered — roles are enforced locally only'
    const can = (x: (typeof roles)[number]) => !x.account ? 'no owner on ENS' : x.canGrant ? 'publishes · can grant' : x.canPublish ? 'publishes' : x.role === 'contributor' ? (x.canPropose ? 'can propose on ENS' : 'cannot propose on ENS') : 'cannot publish'
    return `on ENS (resolver ${resolver}): ${roles.map((x) => `${x.role} ${x.name} — ${can(x)}`).join('; ')}`
  } catch { return 'on ENS: could not read roles right now' }
}

const server = new McpServer({ name: 'knowledge', version: '0.3.2' })
const text = (body: string) => ({ content: [{ type: 'text' as const, text: body }] })
const fail = (e: unknown) => ({ isError: true as const, content: [{ type: 'text' as const, text: notice(`error: ${e instanceof Error ? e.message : String(e)}`) }] })
const run = async (fn: () => string | Promise<string>) => { try { return text(await fn()) } catch (e) { return fail(e) } }
const NS = z.string().optional().describe('namespace, e.g. cancer-research.eth or alice.eth (default: KNOWLEDGE_NAMESPACE)')
const SOURCE = z.object({ type: z.string(), id: z.string().optional(), title: z.string().optional(), excerpt: z.string().optional() })

// ---- consume ----

server.tool('knowledge_resolve', 'Describe a namespace: title, version, owner and policy, who may publish it on ENS, branches, open proposals, parent and children. Start here when an agent is pointed at a name.', { namespace: NS },
  async ({ namespace }) => run(async () => {
    const r = repo(namespace); const refs = r.refs
    const onchain = await publishers(r)
    return [notice(`${refs.namespace}${refs.title ? ` — ${refs.title}` : ''} · v${r.version(refs.head)} · ${Object.keys(r.headSnapshot(refs.head)).length} knowledge objects`),
      refs.description ?? '',
      `kind: ${refs.policy.kind} · owner: ${refs.policy.owner} · reviewers: ${refs.policy.reviewers.join(', ') || '(none)'} · contributors: ${Array.isArray(refs.policy.contributors) ? refs.policy.contributors.join(', ') : 'anyone'} · readers: ${refs.policy.readers} · approvals: ${refs.policy.approvals}${refs.policy.approvals === 0 ? ' (auto-land, findings recorded)' : ''} · conflicts: ${refs.policy.conflicts} · signed approvals: ${refs.policy.signedApprovals ? 'required' : 'optional'}`,
      (() => { const lp = r.store.readConfig().publish?.lastPublish; const d = r.publishDue(); return lp ? `published: v${lp.version} at ${lp.at} · ${d.pending} commit(s) since${d.due ? ' · publish due' : ''}` : `published: never · ${d.pending} local commit(s)` })(),
      `branches: ${Object.keys(refs.branches).join(', ') || '(none)'} · open proposals: ${r.proposals().filter((p) => !['committed', 'rejected'].includes(p.status)).length}`,
      refs.parent ? `parent: ${refs.parent}` : '', refs.children.length ? `children: ${refs.children.join(', ')}` : '',
      onchain,
      `acting as: ${r.identity} (${r.roles().join(', ')})`].filter(Boolean).join('\n')
  }))

server.tool('knowledge_search', 'Search a namespace at its current version. Results carry sources, contributor, reviewers and confidence — cite them.',
  { namespace: NS, query: z.string().min(1), topic: z.string().optional(), subject: z.string().optional(), type: z.string().optional(), limit: z.number().int().min(1).max(50).default(10) },
  async ({ namespace, query, topic, subject, type, limit }) => run(() => {
    const r = repo(namespace)
    const hits = searchSnapshot(r.headSnapshot(r.refs.head), query, { ...(topic !== undefined ? { topic } : {}), ...(subject ? { subject } : {}), ...(type ? { type } : {}), limit })
    return formatHits(r.namespace, r.version(r.refs.head), query, hits)
  }))

server.tool('knowledge_get', 'Fetch one knowledge object by id, at the current version.', { namespace: NS, id: z.string() },
  async ({ namespace, id }) => run(() => { const r = repo(namespace); const k = r.headSnapshot(r.refs.head)[id]; return k ? formatKnowledge(k) : notice(`no knowledge ${id} in ${r.namespace}`) }))

server.tool('knowledge_sources', 'Provenance of one claim: sources, contributor, reviewers, the commit that introduced it, every revision since. Use to answer "why does the namespace say this?"', { namespace: NS, id: z.string() },
  async ({ namespace, id }) => run(() => { const r = repo(namespace); const p = r.why(id, r.refs.head); return p ? formatWhy(p) : notice(`no knowledge ${id} in the history of ${r.namespace}`) }))

server.tool('knowledge_history', 'Commit history of a branch, newest first, with version numbers.', { namespace: NS, branch: z.string().optional(), limit: z.number().int().min(1).max(200).default(20) },
  async ({ namespace, branch, limit }) => run(() => { const r = repo(namespace); const b = branch ?? r.refs.head; return formatLog(b, r.log(b, limit), r.version(b)) }))

server.tool('knowledge_diff', 'Diff two refs (branch, vN, HEAD or commit id): claims added, removed and changed field by field.', { namespace: NS, from: z.string(), to: z.string().default('HEAD') },
  async ({ namespace, from, to }) => run(() => formatDiff(repo(namespace).diff(from, to))))

server.tool('knowledge_status', 'Current branch, version, roles of this agent, uncommitted changes, open proposals, unpushed commits.', { namespace: NS },
  async ({ namespace }) => run(() => {
    const r = repo(namespace); const s = r.status()
    return [notice(`${s.namespace} · branch ${s.branch} · v${s.version} · acting as ${r.identity} (${s.roles.join(', ')})`),
      s.head ? `HEAD ${shortId(s.head.id)} — ${s.head.message}` : 'no commits yet',
      `${Object.keys(r.index()).length} objects · ${s.openProposals} open proposal(s) · ${s.unresolvedFindings} unresolved finding(s)`,
      `publish: ${s.publish.pending} pending commit(s) · ${s.publish.due ? 'DUE' : 'not due'} (${s.publish.reason})${s.publish.last ? ` · last v${s.publish.last.version} at ${s.publish.last.at}` : ' · never published'}`,
      s.staged.changes.length ? `uncommitted:\n${formatDiff(s.staged)}` : 'nothing to commit'].join('\n')
  }))

// ---- contribute ----

const ITEM = z.object({ claim: z.string().min(1), subject: z.string().nullable().optional(), topic: z.string().nullable().optional(), type: z.string().optional(), confidence: z.number().min(0).max(1).optional(), sources: z.array(SOURCE).optional(), tags: z.array(z.string()).optional(), supersedes: z.string().optional().describe('id of the claim this one replaces — a fact that changed, not a contradiction') })

server.tool('knowledge_propose', 'Contribute knowledge for review: creates a branch, commits the items, opens a proposal and runs the automated review (duplicates, contradictions, missing sources). Lands on the default branch only after a reviewer approves.',
  { namespace: NS, title: z.string().min(1), description: z.string().optional(), items: z.array(ITEM).min(1) },
  async ({ namespace, title, description, items }) => run(() => {
    const r = repo(namespace)
    const prev = r.branch; const branch = `contrib/${Date.now().toString(36)}`
    r.checkout(branch, { create: true })
    try {
      for (const i of items) r.add({ claim: i.claim, ...(i.subject !== undefined ? { subject: i.subject } : {}), ...(i.topic !== undefined ? { topic: i.topic } : {}), ...(i.type ? { type: i.type } : {}), ...(i.confidence !== undefined ? { confidence: i.confidence } : {}), ...(i.sources ? { sources: i.sources as Source[] } : {}), ...(i.tags ? { tags: i.tags } : {}), ...(i.supersedes ? { supersedes: i.supersedes } : {}) })
      r.commit(title)
      const p = r.propose({ title, ...(description ? { description } : {}), branch })
      if (p.status === 'committed') return `${notice(`auto-landed #${p.number} on ${r.namespace} (approvals: 0) — now v${r.version(r.refs.head)}${p.findings.length ? '; findings recorded for the owner' : ''}`)}\n${renderFindings(p.findings)}`
      return `${notice(`opened proposal #${p.number} on ${r.namespace} (${p.status})`)}\n${formatProposal(p)}`
    } finally { r.checkout(prev) }
  }))

server.tool('knowledge_review', 'List open proposals, inspect one (findings + diff), or record a verdict. Approve/reject need the reviewer role; a contributor cannot approve their own proposal.',
  { namespace: NS, proposal: z.union([z.number(), z.string()]).optional(), verdict: z.enum(['approve', 'reject', 'comment']).optional(), comment: z.string().optional(), all: z.boolean().default(false) },
  async ({ namespace, proposal, verdict, comment, all }) => run(() => {
    const r = repo(namespace)
    if (proposal === undefined) { const list = r.proposals().filter((p) => all || !['committed', 'rejected'].includes(p.status)); return list.length ? list.map(formatProposal).join('\n\n') : notice('no open proposals') }
    if (!verdict) { const p = r.proposal(proposal); return `${formatProposal(p)}\n\nchanges:\n${formatDiff(r.proposalDiff(proposal))}` }
    const p = r.review(proposal, verdict, comment)
    return notice(`${verdict} by ${r.identity} — proposal #${p.number} is now ${p.status.toUpperCase()}${p.status === 'approved' ? '; land it with knowledge_land' : ''}`)
  }))

server.tool('knowledge_findings', 'Findings recorded on commits that landed without a gate (auto-land on personal namespaces, direct owner commits): the review-later queue. Resolve one by commit id.', { namespace: NS, resolve: z.string().optional().describe('commit id to mark resolved') },
  async ({ namespace, resolve }) => run(() => {
    const r = repo(namespace)
    if (resolve) { r.resolveFindings(resolve); return notice(`resolved findings on ${shortId(r.resolve(resolve).id)}`) }
    const q = r.findings()
    return q.length ? q.map(({ commit, findings }) => `${shortId(commit.id)}  ${commit.message} (${commit.author}, ${commit.timestamp})\n  ${renderFindings(findings).replace(/\n/g, '\n  ')}`).join('\n\n') : notice('no unresolved findings')
  }))

server.tool('knowledge_land', 'Land an approved proposal on its base branch. Stamps the approving reviewers on every changed object and bumps the version.', { namespace: NS, proposal: z.union([z.number(), z.string()]) },
  async ({ namespace, proposal }) => run(() => {
    const r = repo(namespace); const res = r.land(proposal)
    if (res.result.conflicts.length) return `${notice('conflicts — resolve on the branch first')}\n${formatConflicts(res.result.conflicts)}`
    return notice(`landed #${res.proposal.number} as ${shortId(res.commit!.id)} — ${r.namespace} is now v${r.version(res.proposal.base)}`)
  }))

server.tool('knowledge_observe', 'Report something inferred (personal or agent namespaces). The engine adds, reinforces, supersedes or holds it by confidence; commits directly, so it needs commit rights on the branch.',
  { namespace: NS, observation: z.string().min(1), subject: z.string().optional(), topic: z.string().optional(), type: z.string().default('observation'), confidence: z.number().min(0).max(1).default(0.8), threshold: z.number().min(0).max(1).default(0.8), sources: z.array(SOURCE).default([]) },
  async ({ namespace, observation, subject, topic, type, confidence, threshold, sources }) => run(() => {
    const r = repo(namespace)
    const { proposal, commit } = r.observe({ claim: observation, type, confidence, sources: sources as Source[], ...(subject ? { subject } : {}), ...(topic !== undefined ? { topic } : {}) }, { threshold })
    return `${notice(`${proposal.action.toUpperCase()} — ${proposal.reason}${commit ? ` Committed ${shortId(commit.id)} on ${r.branch}.` : ' Nothing committed.'}`)}${proposal.existing && proposal.action !== 'known' ? `\n${formatKnowledge(proposal.existing, { role: 'existing' })}` : ''}\n${formatKnowledge(proposal.knowledge, { role: 'proposed' })}`
  }))

// ---- version control ----

server.tool('knowledge_commit', 'Add items and commit them directly on the current branch (owner/reviewer on the default branch; anyone on their own branch).', { namespace: NS, message: z.string().min(1), items: z.array(ITEM).default([]), remove: z.array(z.string()).default([]) },
  async ({ namespace, message, items, remove }) => run(() => {
    const r = repo(namespace)
    r.assertCanCommit()
    for (const i of items) r.add({ claim: i.claim, ...(i.subject !== undefined ? { subject: i.subject } : {}), ...(i.topic !== undefined ? { topic: i.topic } : {}), ...(i.type ? { type: i.type } : {}), ...(i.confidence !== undefined ? { confidence: i.confidence } : {}), ...(i.sources ? { sources: i.sources as Source[] } : {}), ...(i.tags ? { tags: i.tags } : {}) })
    for (const id of remove) r.remove(id)
    const c = r.commit(message)
    return notice(`[${r.branch} ${shortId(c.id)}] ${c.message} +${c.changes.added.length} ~${c.changes.updated.length} -${c.changes.removed.length}`)
  }))

server.tool('knowledge_branch', 'List branches, create one, or switch (checkout).', { namespace: NS, name: z.string().optional(), checkout: z.boolean().default(false), create: z.boolean().default(false) },
  async ({ namespace, name, checkout, create }) => run(() => {
    const r = repo(namespace)
    if (!name) return Object.entries(r.branches()).map(([b, id]) => `${b === r.branch ? '* ' : '  '}${b}  ${shortId(id)}`).join('\n') || 'no branches'
    if (checkout) { r.checkout(name, { create }); return notice(`on branch ${name}`) }
    r.createBranch(name); return notice(`created branch ${name}`)
  }))

server.tool('knowledge_merge', 'Merge a branch into the current one, three-way by knowledge id. Conflicts are reported, not guessed; resolve with ours/theirs ids.', { namespace: NS, branch: z.string(), ours: z.array(z.string()).default([]), theirs: z.array(z.string()).default([]) },
  async ({ namespace, branch, ours, theirs }) => run(() => {
    const r = repo(namespace); const res: Resolution = {}
    for (const id of ours) res[id] = 'ours'; for (const id of theirs) res[id] = 'theirs'
    const m = r.merge(branch, { resolutions: res })
    if (m.result.conflicts.length) return `${notice(`CONFLICT — ${m.result.conflicts.length} object(s); nothing merged`)}\n\n${formatConflicts(m.result.conflicts)}`
    return notice(m.fastForward ? `fast-forwarded ${r.branch} to ${branch}` : `merged ${branch} into ${r.branch} as ${shortId(m.commit!.id)}`)
  }))

server.tool('knowledge_revert', 'Undo a commit with an inverse commit. History is preserved.', { namespace: NS, ref: z.string() },
  async ({ namespace, ref }) => run(() => {
    const r = repo(namespace); const t = r.resolve(ref); const res = r.revert(ref)
    return res.conflicts.length ? notice(`cannot revert ${shortId(t.id)} cleanly:\n` + res.conflicts.map((c) => `  ${c.id}: ${c.reason}`).join('\n')) : notice(`reverted ${shortId(t.id)} in ${shortId(res.commit!.id)}`)
  }))

// ---- remote ----

server.tool('knowledge_pull', 'Resolve the namespace on ENS and fetch its published history from IPFS. Read-only on chain; no key needed for public namespaces.', { namespace: NS },
  async ({ namespace }) => run(async () => {
    const r = repo(namespace); const res = await remote(r).pull()
    if (!res.remote) return notice(`${r.namespace} has nothing published yet`)
    return notice([`fetched ${res.fetched.length} commit(s) — ${r.namespace} is at v${r.version(r.refs.head)}, published ${res.ageMinutes} min ago (${res.publishedAt}). This is a snapshot: the owner may hold unpublished commits.`, res.fastForwarded.length ? `fast-forwarded: ${res.fastForwarded.join(', ')}` : '', res.created.length ? `new branches: ${res.created.join(', ')}` : '', res.diverged.length ? `diverged: ${res.diverged.join(', ')}` : ''].filter(Boolean).join('\n  '))
  }))

server.tool('knowledge_read', 'Read a namespace straight from the network — ENS then IPFS, every object verified by its hash — without pulling it. Sealed namespaces open with this agent\'s own grant (KNOWLEDGE_READER_KEY), e.g. access bought over x402. Optionally search it.',
  { namespace: z.string().describe('namespace, e.g. signals.treasury.eth'), query: z.string().optional(), limit: z.number().int().min(1).max(50).default(10) },
  async ({ namespace, query, limit }) => run(async () => {
    const pk = normalisePrivateKey(process.env.KNOWLEDGE_READER_KEY)
    const network = ensNetwork({ storage: createStorage(), client: createPublicClient({ chain: sepolia, transport: http(RPC) }) as PublicClient })
    try {
      const ns = await resolveNamespace(network, namespace, pk ? { privateKey: pk } : null)
      const how = ns.readers === 'public' ? 'public' : `sealed · opened with ${ns.grant?.owner ? 'the owner key' : `grant for ${ns.grant?.agent ?? 'this key'}`}${ns.grant?.validUntil ? `, valid until ${ns.grant.validUntil.slice(0, 10)}` : ''}`
      const head = notice(`${ns.namespace} v${ns.version} · ${ns.claims.length} claims · ${how} · published ${ns.publishedAt}`)
      if (!query) return `${head}\n${ns.claims.slice(0, limit).map((k) => formatKnowledge(k)).join('\n\n')}`
      const snapshot = Object.fromEntries(ns.claims.map((k) => [k.id, k]))
      return `${head}\n${formatHits(ns.namespace, ns.version, query, searchSnapshot(snapshot, query, { limit }))}`
    } catch (e) {
      if (e instanceof AccessDenied) return notice(`${e.message}${pk ? '' : ' — set KNOWLEDGE_READER_KEY to the key your grant was sealed to'}`)
      if (e instanceof NotPublished) return notice(e.message)
      throw e
    }
  }))

server.tool('knowledge_push', 'Publish unpushed commits and move the ENS pointer once. Needs PRIVATE_KEY (namespace owner) in this process; refuses otherwise. ifDue=true publishes only when the namespace publish policy says so.', { namespace: NS, ifDue: z.boolean().default(false) },
  async ({ namespace, ifDue }) => run(async () => {
    const r = repo(namespace)
    if (!normalisePrivateKey(process.env.PRIVATE_KEY)) throw new Error('push needs PRIVATE_KEY for the wallet that owns the namespace; not set for this server')
    if (ifDue) { const d = r.publishDue(); if (!d.due) return notice(`not due: ${d.reason}`) }
    const res = await remote(r).push()
    return res.noop ? notice('everything up-to-date') : notice(`published ${r.namespace} v${r.version(r.refs.head)} — ${res.pushed.length} commit(s)\n  refs: ${res.refsRef.ref}\n  contenthash: ${res.contenthash}${res.receipt ? `\n  tx: ${res.receipt}` : ''}`)
  }))

await server.connect(new StdioServerTransport())
