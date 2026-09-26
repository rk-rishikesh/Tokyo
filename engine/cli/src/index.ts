/**
 * `knowledge` — the CLI for ENS-native knowledge namespaces (PRD §35).
 *
 *   knowledge init cancer-research.eth [--register] [--private] [--title "Cancer Research"]
 *   knowledge add "<claim>" --subject "Pembrolizumab" --topic immunotherapy --source document:"FDA approval, May 2017"
 *   knowledge get [<id>] · search "<query>" · log · status · diff <ref> [<ref>] · why <id>
 *   knowledge branch [<name>] · checkout <branch> [-b] · merge <branch> · revert <ref>
 *   knowledge propose --title "…"            (current branch → default branch, runs automated review)
 *   knowledge proposals · review <n> [--approve|--reject|--comment "…"] · land <n>
 *   knowledge policy [--reviewer x.eth]... [--contributors anyone|a.eth,b.eth] [--approvals 1]
 *   knowledge push · pull
 *
 * Everything but init --register, push and pull is local and offline.
 * `--as <name.eth>` acts as another identity (roles are enforced locally; the pointer is enforced on chain).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { searchSnapshot, generateContentKey, shortId, checkSubjectAddressing, renderFindings, SOURCE_KINDS, type NamespaceKind, type Resolution, type Source, type SourceKind } from '@knowledge01/core'
import { recoverMessageAddress, type Hex } from 'viem'
import { findOwner } from '@knowledge01/core'
import { importWikipedia } from './wikipedia.js'
import { applyImport, planImport, readExport, VENDORS, type Vendor } from './memory-export.js'
import { epochEnd, OWNER_KEY_MESSAGE, ownerKeyFromSignature, readManifest, Repository, RepoStore, repoPath, rotateEpoch, grantAccess, setOffers, type AccessOffer } from '@knowledge01/repo'
import { actAs, localNamespaces, network, openRepo, publicClient, remoteFor, resolveNamespace, walletClient } from './context.js'
import { fmt } from './format.js'
import { registerNamespace } from './register.js'

const HELP = `knowledge — ENS-native, versioned knowledge namespaces

  init <name.eth> [--register] [--private] [--kind public|organisation|personal] [--key <hex>] [--title t] [--description d]
  add "<claim>" [--subject s] [--topic t] [--type fact] [--confidence 0.9] [--source type:title[:id]]... [--tag x]... [--supersedes <id>]
  add --file items.json                       (array of {claim, subject, topic, type, confidence, sources, tags})
  observe "<observation>" [--topic t] [--confidence 0.87] [--threshold 0.8]
  get [<id>] · search "<query>" [--topic t] [--subject s] [--limit 10]
  log [--branch b] [--limit 20] · status · diff <ref> [<ref>] · why <id>
  branch [<name>] [--delete] · checkout <branch> [-b] · merge <branch> [--ours id]... [--theirs id]... · revert <ref>
  commit -m "<message>" · update <id> [--claim …] [--confidence …] [--source …] · remove <id>
  propose --title "<title>" [--description d] [--branch b]
  proposals [--all] · review <n> [--approve | --reject | --comment] [-m "<comment>"] [--sign] · land <n> [--allow-unverified]
  propose --export [--publish]        bundle the proposal for another owner (fork-and-pull); --publish pins it and records it in your outbox
  pull-proposal <cid> | --from <contributor.eth>     ingest a contributor's bundle into the review queue
  findings [--resolve <commit>]       findings recorded on ungated commits (auto-land / direct commits)
  policy [--reviewer x.eth]... [--contributors anyone|a.eth,b.eth] [--approvals n] [--readers public|key]
         [--conflicts ask|latest|confidence] [--publish manual|interval|threshold] [--interval-minutes n] [--pending-commits n] [--signed-approvals true|false]
  push [--if-due]                     publish; --if-due only when the namespace's publish policy says so
  source connect "<name>" --kind human|document|api|agent|application [--description d]
  source list
  import wikipedia "<article title>" [--topic t] [--subject s] [--limit 6]     (real fetch → proposal)
  import memory <export.json|dir> [--vendor chatgpt|claude|instinct|mem0|supermemory|generic]
       [--split] [--owner you.eth] [--apply] [--confidence 0.7] [--limit n]
       leave a vendor, keep what it learned: an export's remembered facts become claims you own.
       Dry run by default; --split routes each topic to its own namespace (food.you.eth, work.you.eth).
  namespaces · push · pull
  offer --price 0.01 --pay-to 0x… --endpoint <url> [--chain eip155:84532] [--epoch-days 7] [--role read]
                                      sell access over x402: the price is published in the access manifest
  access [owner]                      show grants, receipts and offers · owner: seal your own recovery grant
  rotate                              end the epoch: drop expired paid grants with one re-key

Sources on add/update: --source <type>:<title>[:<id>]  or  --source <kind>/<name>:<title>[:<id>]
  e.g. --source document:"Treasury policy v3"   --source agent/watch-agent.eth:"Payroll Safe outflows"

Global: --namespace <name.eth>  (or KNOWLEDGE_NAMESPACE; automatic when only one exists)
        --as <identity.eth>     act as another identity   --json   machine-readable output
`

const { values: v, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    namespace: { type: 'string', short: 'n' }, as: { type: 'string' },
    register: { type: 'boolean' }, private: { type: 'boolean' }, key: { type: 'string' },
    title: { type: 'string' }, description: { type: 'string' },
    subject: { type: 'string', short: 's' }, topic: { type: 'string', short: 't' }, type: { type: 'string' },
    confidence: { type: 'string' }, threshold: { type: 'string' }, source: { type: 'string', multiple: true }, tag: { type: 'string', multiple: true },
    claim: { type: 'string' }, file: { type: 'string' },
    limit: { type: 'string', short: 'l' }, branch: { type: 'string' }, delete: { type: 'boolean', short: 'd' },
    message: { type: 'string', short: 'm' }, ours: { type: 'string', multiple: true }, theirs: { type: 'string', multiple: true },
    approve: { type: 'boolean' }, reject: { type: 'boolean' }, comment: { type: 'boolean' }, all: { type: 'boolean' },
    reviewer: { type: 'string', multiple: true }, contributors: { type: 'string' }, approvals: { type: 'string' }, readers: { type: 'string' },
    kind: { type: 'string' }, supersedes: { type: 'string' }, sign: { type: 'boolean' }, 'allow-unverified': { type: 'boolean' },
    vendor: { type: 'string' }, split: { type: 'boolean' }, owner: { type: 'string' }, apply: { type: 'boolean' },
    export: { type: 'boolean' }, publish: { type: 'string' }, from: { type: 'string' }, resolve: { type: 'string' }, 'if-due': { type: 'boolean' },
    conflicts: { type: 'string' }, 'interval-minutes': { type: 'string' }, 'pending-commits': { type: 'string' }, 'signed-approvals': { type: 'string' },
    price: { type: 'string' }, 'pay-to': { type: 'string' }, endpoint: { type: 'string' }, chain: { type: 'string' }, 'epoch-days': { type: 'string' }, role: { type: 'string' },
    b: { type: 'boolean' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  },
})

const [cmd, ...args] = positionals
// `knowledge … | head` closes the pipe early; that is not an error worth a stack trace.
process.stdout.on('error', (e: NodeJS.ErrnoException) => { if (e.code === 'EPIPE') process.exit(0); throw e })
const out = (s: string): void => { process.stdout.write(s + '\n') }
const json = (o: unknown): void => out(JSON.stringify(o, null, 2))
const limit = v.limit ? Number(v.limit) : undefined
const ago = (iso: string) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60_000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago` }
/** `type:title[:id]` or `kind/name:title[:id]`; ids may contain ':' (URLs), so split only twice. */
const parseSources = (list: string[] | undefined): Source[] | undefined =>
  list?.map((s) => {
    const [head, title, ...rest] = s.split(':')
    const id = rest.length ? rest.join(':') : undefined
    const [kindOrType, name] = head!.split('/')
    const kind = SOURCE_KINDS.includes(kindOrType as SourceKind) ? (kindOrType as SourceKind) : undefined
    return { type: kind ? (name ? name.toLowerCase() : kind) : kindOrType!, ...(kind ? { kind } : {}), ...(name ? { name } : {}), ...(title ? { title } : {}), ...(id ? { id } : {}) }
  })

const repoArg = () => actAs(openRepo(v.namespace), v.as)

async function main(): Promise<void> {
  if (!cmd || v.help) return out(HELP)

  switch (cmd) {
    case 'init': {
      const name = args[0]
      if (!name) throw new Error('usage: knowledge init <name.eth> [--register] [--private]')
      let repo: Repository
      if (RepoStore.exists(repoPath(name))) {
        repo = Repository.open(name)
        out(fmt.dim(`namespace ${name} already exists locally`))
      } else {
        const contentKey = v.key ?? (v.private ? Buffer.from(generateContentKey()).toString('hex') : undefined)
        const parent = name.split('.').slice(1).join('.')
        const warn = checkSubjectAddressing(name)
        if (warn) out(fmt.warn(`warning: ${warn.message}`))
        const kind = (v.kind as NamespaceKind | undefined) ?? (contentKey ? 'personal' : 'public')
        if (v.kind && !['public', 'organisation', 'personal'].includes(v.kind)) throw new Error('--kind must be public, organisation or personal')
        repo = Repository.init(name, v.as ?? name, {
          ...(contentKey ? { contentKey } : {}), readers: contentKey ? 'key' : 'public', kind,
          ...(v.title ? { title: v.title } : {}), ...(v.description ? { description: v.description } : {}),
          ...(parent !== 'eth' && parent ? { parent } : {}),
        })
        if (parent && parent !== 'eth' && RepoStore.exists(repoPath(parent))) Repository.open(parent).addChild(name)
        out(fmt.ok(`Initialized knowledge namespace ${name}`) + fmt.dim(`  (${repo.policy.kind} · ${contentKey ? 'encrypted' : 'plaintext'} · approvals ${repo.policy.approvals}${repo.policy.approvals === 0 ? ' (auto-land)' : ''} · conflicts ${repo.policy.conflicts} · publish ${repo.policy.publish.mode}${repo.policy.publish.intervalMinutes ? ` ${repo.policy.publish.intervalMinutes}m` : ''} · owner ${repo.identity})`))
        out(fmt.dim(`  path: ${repoPath(name)}`))
        if (contentKey && !v.key) out(fmt.warn(`  key:  0x${contentKey}  (keep this — readers need it)`))
      }
      if (v.register) {
        const wallet = walletClient()
        if (!wallet) throw new Error('--register needs PRIVATE_KEY (the wallet that will own the name)')
        out(`Registering ${name} on Sepolia…`)
        const r = await registerNamespace(name, publicClient(), wallet, (m) => out(fmt.dim('  ' + m)))
        out(fmt.ok(r.alreadyRegistered ? `${name} was already registered` : `Registered ${name} → registry ${r.registry}, resolver ${r.resolver}`))
      }
      return
    }

    case 'namespaces': {
      for (const ns of localNamespaces()) { const r = Repository.open(ns); out(`${fmt.bold(ns)}  ${fmt.dim(`v${r.version(r.refs.head)} · ${Object.keys(r.headSnapshot(r.refs.head)).length} objects · ${r.policy.readers} · owner ${r.policy.owner}`)}`) }
      return
    }

    case 'add': {
      const repo = repoArg()
      const items: Parameters<Repository['add']>[0][] = v.file
        ? (JSON.parse(readFileSync(v.file, 'utf8')) as Parameters<Repository['add']>[0][])
        : [{ claim: args.join(' '), ...(v.subject ? { subject: v.subject } : {}), ...(v.topic !== undefined ? { topic: v.topic } : {}), ...(v.type ? { type: v.type } : {}), ...(v.confidence ? { confidence: Number(v.confidence) } : {}), ...(parseSources(v.source) ? { sources: parseSources(v.source)! } : {}), ...(v.tag ? { tags: v.tag } : {}), ...(v.supersedes ? { supersedes: v.supersedes } : {}) }]
      if (!items.length || !items[0]!.claim) throw new Error('usage: knowledge add "<claim>" [--subject s] [--topic t] [--source type:title]')
      const added = items.map((i) => repo.add(i))
      if (v.json) return json(added)
      for (const k of added) out(`${fmt.ok(k.sources.length > 1 && k.updated_at ? '~' : '+')} ${fmt.knowledge(k)}${k.supersedes ? fmt.dim(`\n  supersedes ${k.supersedes} (retired from the snapshot; kept in history)`) : ''}`)
      out(fmt.dim(`staged ${added.length} — commit with \`knowledge commit -m "…"\`${repo.branch === repo.refs.head ? '' : ' then `knowledge propose`'}`))
      return
    }

    case 'observe': {
      const claim = args.join(' ')
      if (!claim) throw new Error('usage: knowledge observe "<observation>"')
      const repo = repoArg()
      const { proposal, commit } = repo.observe({ claim, ...(v.subject ? { subject: v.subject } : {}), ...(v.topic !== undefined ? { topic: v.topic } : {}), ...(v.type ? { type: v.type } : {}), ...(v.confidence ? { confidence: Number(v.confidence) } : {}), ...(v.tag ? { tags: v.tag } : {}) }, { ...(v.threshold ? { threshold: Number(v.threshold) } : {}) })
      if (v.json) return json({ proposal, commit: commit?.id })
      const tag = { add: fmt.ok('ADD'), update: fmt.ok('UPDATE'), known: fmt.dim('KNOWN'), conflict: fmt.warn('CONFLICT'), 'below-threshold': fmt.dim('HOLD') }[proposal.action]
      out(`${tag}  ${proposal.reason}`)
      if (commit) out(`${fmt.ok('✓')} committed ${fmt.bold(shortId(commit.id))} on ${repo.branch}`)
      return
    }

    case 'get': {
      const repo = repoArg()
      const id = args[0]
      const snap = repo.headSnapshot()
      if (!id) {
        const r = repo.refs
        out(`${fmt.bold(repo.namespace)}${r.title ? `  — ${r.title}` : ''}`)
        if (r.description) out(fmt.dim(`  ${r.description}`))
        out(fmt.dim(`  v${repo.version(r.head)} · ${Object.keys(snap).length} knowledge objects · ${Object.keys(r.branches).length} branches · ${repo.proposals().filter((p) => !['committed', 'rejected'].includes(p.status)).length} open proposal(s)`))
        out(fmt.dim(`  ${r.policy.kind} · owner ${r.policy.owner} · reviewers ${r.policy.reviewers.join(', ') || '(none)'} · contributors ${Array.isArray(r.policy.contributors) ? r.policy.contributors.join(', ') : 'anyone'} · readers ${r.policy.readers} · approvals ${r.policy.approvals} · conflicts ${r.policy.conflicts}`))
        const lp = repo.store.readConfig().publish?.lastPublish
        out(fmt.dim(lp ? `  published v${lp.version} ${ago(lp.at)} · ${repo.publishDue().pending} commit(s) since` : '  not published yet'))
        if (r.parent) out(fmt.dim(`  parent ${r.parent}`))
        if (r.children.length) out(fmt.dim(`  children ${r.children.join(', ')}`))
        if (v.json) return json({ refs: r, version: repo.version(r.head) })
        const items = Object.values(snap).sort((a, b) => (a.subject ?? '').localeCompare(b.subject ?? ''))
        if (items.length) out('\n' + items.map((k) => fmt.knowledge(k)).join('\n\n'))
        return
      }
      const k = snap[id]
      if (!k) throw new Error(`no knowledge ${id} on ${repo.branch}`)
      if (v.json) return json(k)
      out(fmt.knowledge(k))
      for (const s of k.sources) out(fmt.dim(`    source: ${s.type}${s.title ? ` "${s.title}"` : ''}${s.id ? ` ${s.id}` : ''}${s.excerpt ? ` — "${s.excerpt}"` : ''}`))
      return
    }

    case 'search': {
      const repo = repoArg()
      const hits = searchSnapshot(repo.index(), args.join(' '), { ...(v.topic !== undefined ? { topic: v.topic } : {}), ...(v.subject ? { subject: v.subject } : {}), ...(v.type ? { type: v.type } : {}), limit: limit ?? 10 })
      if (v.json) return json(hits)
      out(hits.length ? hits.map(fmt.hit).join('\n\n') : fmt.dim('no matching knowledge'))
      return
    }

    case 'log': {
      const repo = repoArg()
      const branch = v.branch ?? repo.branch
      const all = repo.log(branch, 100_000)
      const commits = all.slice(0, limit ?? 20)
      if (v.json) return json(commits.map(({ snapshot: _s, ...c }) => c))
      if (!commits.length) return out(fmt.dim(`no commits on ${branch}`))
      const head = repo.headCommit()?.id
      out(commits.map((c, i) => fmt.commit(c, { head: c.id === head, version: branch === repo.refs.head ? all.length - i : 0 })).join('\n'))
      return
    }

    case 'status': {
      const repo = repoArg()
      const s = repo.status()
      if (v.json) return json({ ...s, head: s.head?.id })
      out(`${fmt.bold(s.namespace)} · branch ${fmt.bold(s.branch)} · v${s.version} · acting as ${repo.identity} (${s.roles.join(', ')})`)
      out(s.head ? `HEAD ${shortId(s.head.id)} — ${s.head.message}` : fmt.dim('no commits yet'))
      out(fmt.dim(`${Object.keys(repo.index()).length} objects · ${Object.keys(s.branches).length} branches · ${s.openProposals} open proposal(s) · ${s.unresolvedFindings} unresolved finding(s)`))
      out(fmt.dim(`publish: ${s.publish.pending} pending commit(s) · ${s.publish.due ? fmt.warn('due') : 'not due'} (${s.publish.reason})${s.publish.last ? ` · last published v${s.publish.last.version} ${ago(s.publish.last.at)}` : ' · never published'}`))
      if (s.staged.changes.length) { out('\nUncommitted changes:'); out(fmt.diff(s.staged)) } else out(fmt.dim('nothing to commit'))
      return
    }

    case 'branch': {
      const repo = repoArg()
      const name = args[0]
      if (!name) { for (const [b, id] of Object.entries(repo.branches())) out(`${b === repo.branch ? '* ' : '  '}${b}  ${fmt.dim(shortId(id))}`); return }
      if (v.delete) { repo.deleteBranch(name); return out(`Deleted branch ${name}`) }
      repo.createBranch(name, v.branch); out(`Created branch ${fmt.bold(name)} from ${v.branch ?? repo.branch}`)
      return
    }

    case 'checkout': {
      const repo = repoArg(); const name = args[0]
      if (!name) throw new Error('usage: knowledge checkout <branch> [-b]')
      repo.checkout(name, { create: !!v.b }); out(`Switched to branch ${fmt.bold(name)}`)
      return
    }

    case 'diff': {
      const repo = repoArg(); const [a, b] = args
      if (!a) throw new Error('usage: knowledge diff <ref> [<ref>]')
      const d = repo.diff(a, b ?? 'HEAD')
      if (v.json) return json(d)
      out(d.changes.length ? fmt.diff(d) : fmt.dim('no differences'))
      return
    }

    case 'merge': {
      const repo = repoArg(); const other = args[0]
      if (!other) throw new Error('usage: knowledge merge <branch>')
      const resolutions: Resolution = {}
      for (const id of v.ours ?? []) resolutions[id] = 'ours'
      for (const id of v.theirs ?? []) resolutions[id] = 'theirs'
      const r = repo.merge(other, { resolutions, ...(v.message ? { message: v.message } : {}) })
      if (r.result.conflicts.length) { out(fmt.warn(`CONFLICT: ${r.result.conflicts.length} object(s) changed on both branches`)); out(r.result.conflicts.map(fmt.conflict).join('\n\n')); process.exitCode = 1; return }
      out(r.fastForward ? `${fmt.ok('✓')} fast-forwarded ${repo.branch} to ${other}` : `${fmt.ok('✓')} merged ${other} into ${repo.branch} — ${shortId(r.commit!.id)}`)
      return
    }

    case 'revert': {
      const repo = repoArg(); const ref = args[0]
      if (!ref) throw new Error('usage: knowledge revert <ref>')
      const target = repo.resolve(ref); const r = repo.revert(ref)
      if (r.conflicts.length) { out(fmt.warn('cannot revert cleanly:')); for (const c of r.conflicts) out(`  ${c.id}: ${c.reason}`); process.exitCode = 1; return }
      out(`${fmt.ok('✓')} reverted ${shortId(target.id)} in new commit ${shortId(r.commit!.id)} — history preserved`)
      return
    }

    case 'why': {
      const repo = repoArg(); const id = args[0]
      if (!id) throw new Error('usage: knowledge why <id>')
      const p = repo.why(id)
      if (!p) return out(fmt.dim(`no knowledge ${id} in the history of ${repo.branch}`))
      if (v.json) return json(p)
      out(fmt.why(p))
      return
    }

    case 'update': {
      const repo = repoArg(); const id = args[0]
      if (!id) throw new Error('usage: knowledge update <id> [--claim …] [--confidence …] [--source …]')
      const cur = repo.index()[id]
      if (!cur) throw new Error(`no knowledge ${id}`)
      const k = repo.update(id, { ...(v.claim ? { claim: v.claim } : {}), ...(v.subject ? { subject: v.subject } : {}), ...(v.confidence ? { confidence: Number(v.confidence) } : {}), ...(v.topic !== undefined ? { topic: v.topic } : {}), ...(v.type ? { type: v.type } : {}), ...(v.tag ? { tags: v.tag } : {}), ...(parseSources(v.source) ? { sources: [...cur.sources, ...parseSources(v.source)!] } : {}) })
      out(`${fmt.ok('~')} ${fmt.knowledge(k)}\n${fmt.dim('staged — commit with `knowledge commit -m "…"`')}`)
      return
    }

    case 'remove': {
      const repo = repoArg(); const id = args[0]
      if (!id || !repo.remove(id)) throw new Error(`no knowledge ${id}`)
      out(`${fmt.ok('-')} removed ${id} (staged — it stays in history)`)
      return
    }

    case 'commit': {
      const repo = repoArg()
      if (!v.message) throw new Error('usage: knowledge commit -m "<message>"')
      const c = repo.commit(v.message)
      out(`[${repo.branch} ${shortId(c.id)}] ${c.message}  ${fmt.dim(`+${c.changes.added.length} ~${c.changes.updated.length} -${c.changes.removed.length}`)}`)
      return
    }

    case 'propose': {
      const repo = repoArg()
      if (!v.title) throw new Error('usage: knowledge propose --title "<title>" [--description …] [--branch b]')
      const p = repo.propose({ title: v.title, ...(v.description ? { description: v.description } : {}), ...(v.branch ? { branch: v.branch } : {}) })
      if (v.json && !v.export) return json(p)
      if (p.status === 'committed') { out(`${fmt.ok('✓')} proposal ${fmt.bold(`#${p.number}`)} auto-landed (approvals: 0) — ${repo.namespace} is now v${repo.version(repo.refs.head)}`); if (p.findings.length) out(fmt.findings(p.findings) + fmt.dim('\n  recorded in the findings queue: knowledge findings')); return }
      out(`${fmt.ok('✓')} proposal ${fmt.bold(`#${p.number}`)} opened: ${p.branch} → ${p.base}`)
      out(fmt.findings(p.findings))
      if (v.export) {
        const bundle = repo.exportProposal(p.number)
        if (v.publish !== undefined) {
          const { ref } = await remoteFor(repo).publishBundle(bundle)
          out(`${fmt.ok('✓')} bundle published: ${fmt.bold(ref.ref)} — the owner runs: knowledge pull-proposal ${ref.ref} --namespace ${repo.namespace}`)
          out(fmt.dim('recorded in your outbox; `knowledge push` publishes the outbox with your refs'))
        } else {
          const file = `proposal-${p.number}.bundle.json`
          writeFileSync(file, JSON.stringify(bundle, null, 2))
          out(`${fmt.ok('✓')} bundle written to ${file} — the owner runs: knowledge pull-proposal ${file}`)
        }
        return
      }
      out(fmt.dim(`reviewers: knowledge review ${p.number} --approve | --reject | --comment -m "…"`))
      return
    }

    case 'proposals': {
      const repo = repoArg()
      const list = repo.proposals().filter((p) => v.all || !['committed', 'rejected'].includes(p.status))
      if (v.json) return json(list)
      out(list.length ? list.map(fmt.proposal).join('\n') : fmt.dim('no open proposals'))
      return
    }

    case 'review': {
      const repo = repoArg(); const n = args[0]
      if (!n) throw new Error('usage: knowledge review <n> [--approve|--reject|--comment] [-m "…"]')
      if (!v.approve && !v.reject && !v.comment) {
        const p = repo.proposal(n)
        if (v.json) return json({ proposal: p, diff: repo.proposalDiff(n) })
        out(fmt.proposalDetail(p)); out(''); out(fmt.bold('changes:')); out(fmt.diff(repo.proposalDiff(n)))
        return
      }
      const verdict = v.approve ? 'approve' : v.reject ? 'reject' : 'comment'
      let signed: { at: string; signature: string; signer: string } | undefined
      if (v.sign) {
        const wallet = walletClient()
        if (!wallet?.account) throw new Error('--sign needs PRIVATE_KEY: the key that owns your ENS name')
        const at = new Date().toISOString()
        const { message } = repo.reviewText(n, verdict, at)
        const signature = await wallet.signMessage({ account: wallet.account, message })
        signed = { at, signature, signer: wallet.account.address }
      }
      const p = repo.review(n, verdict, v.message, signed)
      out(`${fmt.ok('✓')} ${verdict} recorded by ${repo.identity}${signed ? ` (signed by ${signed.signer.slice(0, 8)}…)` : fmt.dim(' (unsigned — a claim, not a proof)')} — proposal #${p.number} is now ${p.status.toUpperCase()}`)
      if (p.status === 'approved') out(fmt.dim(`land it with: knowledge land ${p.number}`))
      return
    }

    case 'land': {
      const repo = repoArg(); const n = args[0]
      if (!n) throw new Error('usage: knowledge land <n> [--allow-unverified]')
      const pr = repo.proposal(n)
      if (pr.reviews.some((x) => x.verdict === 'approve' && x.signature)) {
        const pc = publicClient()
        const reviews = await repo.verifyApprovals(n, (name) => findOwner(pc, name).then((a) => (BigInt(a) === 0n ? null : a)).catch(() => null), (message, signature) => recoverMessageAddress({ message, signature: signature as Hex }))
        for (const x of reviews.filter((x) => x.verdict === 'approve')) out(fmt.dim(`  approval by ${x.reviewer}: ${x.signature ? (x.verified ? fmt.ok('verified — signer owns the name') : fmt.warn('signature does not match the name owner')) : 'unsigned (claimed)'}`))
      }
      if (v['allow-unverified'] && repo.policy.signedApprovals) { repo.setPolicy({ signedApprovals: false }); out(fmt.warn('  --allow-unverified: signed-approval requirement lifted for this land')) }
      const r = repo.land(n)
      if (r.result.conflicts.length) { out(fmt.warn('conflicts — resolve on the branch first:')); out(r.result.conflicts.map(fmt.conflict).join('\n\n')); process.exitCode = 1; return }
      out(`${fmt.ok('✓')} landed #${r.proposal.number} on ${r.proposal.base} as ${shortId(r.commit!.id)} — ${repo.namespace} is now v${repo.version(r.proposal.base)}`)
      return
    }

    case 'pull-proposal': {
      const repo = repoArg(); const src = args[0]
      if (!src && !v.from) throw new Error('usage: knowledge pull-proposal <cid|file.json> | --from <contributor.eth>')
      const remote = remoteFor(repo)
      const cids: string[] = []
      if (v.from) {
        const { getContenthash } = await import('@knowledge01/core')
        const ch = await getContenthash(publicClient(), v.from)
        if (!ch || ch === '0x') throw new Error(`${v.from} has nothing published`)
        cids.push(...(await remote.inboxFrom(ch)))
        if (!cids.length) return out(fmt.dim(`${v.from} has no proposals for ${repo.namespace} in its outbox`))
      } else cids.push(src!)
      for (const c of cids) {
        const bundle = existsSync(c) ? JSON.parse(readFileSync(c, 'utf8')) : await remote.fetchBundle(c)
        const p = repo.importProposal(bundle)
        out(`${fmt.ok('✓')} imported proposal ${fmt.bold(`#${p.number}`)} "${p.title}" by ${p.author} (${bundle.commits.length} commit(s), verified by hash) — ${p.status.toUpperCase()}`)
        out(fmt.findings(p.findings))
      }
      return
    }

    case 'findings': {
      const repo = repoArg()
      if (v.resolve) { repo.resolveFindings(v.resolve); return out(`${fmt.ok('✓')} resolved findings on ${shortId(repo.resolve(v.resolve).id)}`) }
      const q = repo.findings()
      if (v.json) return json(q)
      if (!q.length) return out(fmt.dim('no unresolved findings — every ungated commit was clean'))
      for (const { commit, findings } of q) { out(fmt.commit(commit)); out('  ' + renderFindings(findings).replace(/\n/g, '\n  ')) }
      out(fmt.dim(`\nresolve with: knowledge findings --resolve <commit>`))
      return
    }

    case 'policy': {
      const repo = repoArg()
      const patch = {
        ...(v.reviewer ? { reviewers: v.reviewer } : {}),
        ...(v.contributors ? { contributors: v.contributors === 'anyone' ? 'anyone' as const : v.contributors.split(',').map((s) => s.trim()) } : {}),
        ...(v.approvals ? { approvals: Number(v.approvals) } : {}),
        ...(v.readers ? { readers: v.readers as 'public' | 'key' } : {}),
        ...(v.conflicts ? { conflicts: v.conflicts as 'ask' | 'latest' | 'confidence' } : {}),
        ...(v.publish || v['interval-minutes'] || v['pending-commits'] ? { publish: { ...repo.policy.publish, ...(v.publish ? { mode: v.publish as 'manual' | 'interval' | 'threshold' } : {}), ...(v['interval-minutes'] ? { intervalMinutes: Number(v['interval-minutes']) } : {}), ...(v['pending-commits'] ? { pendingCommits: Number(v['pending-commits']) } : {}) } } : {}),
        ...(v['signed-approvals'] ? { signedApprovals: v['signed-approvals'] === 'true' } : {}),
      }
      const policy = Object.keys(patch).length ? repo.setPolicy(patch) : repo.policy
      if (v.title || v.description) repo.describe({ ...(v.title ? { title: v.title } : {}), ...(v.description ? { description: v.description } : {}) })
      if (v.json) return json(policy)
      out(`kind         ${policy.kind}\nowner        ${policy.owner}\nreviewers    ${policy.reviewers.join(', ') || '(none)'}\ncontributors ${Array.isArray(policy.contributors) ? policy.contributors.join(', ') : 'anyone'}\nreaders      ${policy.readers}\napprovals    ${policy.approvals}${policy.approvals === 0 ? '  (auto-land; findings still recorded)' : ''}\nconflicts    ${policy.conflicts}\npublish      ${policy.publish.mode}${policy.publish.intervalMinutes ? ` · every ${policy.publish.intervalMinutes} min` : ''}${policy.publish.pendingCommits ? ` · or ${policy.publish.pendingCommits} pending commits` : ''}\nsigned       ${policy.signedApprovals ? 'approvals must be signed by the reviewer\'s ENS key' : 'approvals are claims (unsigned allowed)'}`)
      return
    }

    case 'source': {
      const repo = repoArg(); const sub = args[0]
      if (sub === 'connect') {
        const name = args.slice(1).join(' ')
        if (!name || !v.kind || !SOURCE_KINDS.includes(v.kind as SourceKind)) throw new Error('usage: knowledge source connect "<name>" --kind human|document|api|agent|application [--description d]')
        const c = repo.connectSource({ name, kind: v.kind as SourceKind, ...(v.description ? { description: v.description } : {}) })
        out(`${fmt.ok('✓')} connected ${fmt.bold(c.name)} (${c.kind}) to ${repo.namespace} — imports are attributed to ${c.contributor}`)
        return
      }
      const list = repo.sources()
      if (v.json) return json(list)
      out(list.length ? list.map((c) => `${fmt.bold(c.name)}  ${fmt.dim(`${c.kind} · ${c.status} · ${c.objects ?? 0} objects cite it · as ${c.contributor}`)}`).join('\n') : fmt.dim('no sources connected — knowledge source connect "<name>" --kind …'))
      return
    }

    case 'import': {
      if (args[0] === 'memory') {
        const path = args[1]
        if (!path) throw new Error('usage: knowledge import memory <export.json|dir> [--vendor chatgpt] [--split] [--owner you.eth] [--apply]')
        const vendor: Vendor = VENDORS[(v.vendor ?? 'generic').toLowerCase()] ?? { id: (v.vendor ?? 'generic').toLowerCase(), name: v.vendor ?? 'Memory export', kind: 'application' }
        // --split needs an owner name to build food.<owner>; otherwise everything lands in one namespace.
        const target = v.namespace ?? process.env.KNOWLEDGE_NAMESPACE
        const owner = v.owner ?? v.as ?? (target && !v.split ? Repository.open(resolveNamespace(target)).identity : undefined)
        if (v.split && !owner) throw new Error('--split needs --owner <you.eth>: topics become food.<owner>, work.<owner>, …')
        if (!v.split && !target) throw new Error('name the namespace to import into with --namespace, or use --split --owner <you.eth>')
        const { parsed, file } = readExport(path)
        const plan = planImport(parsed, { vendor, file, owner: owner ?? target!, namespace: target ?? '', ...(v.split ? { split: true } : {}), ...(v.confidence ? { confidence: Number(v.confidence) } : {}), ...(limit ? { limit } : {}) })
        const total = Object.values(plan.byNamespace).reduce((n, e) => n + e.length, 0)
        if (v.json) return json(plan)
        if (!total) { out(fmt.warn(`no remembered facts found in ${file}`)); out(fmt.dim('Exports differ between vendors. This reads arrays of remembered facts, not conversation transcripts — a transcript would mean inventing claims nobody stated.')); return }
        out(`${fmt.bold(String(total))} remembered fact(s) read from ${fmt.dim(file)}${plan.from ? fmt.dim(` (at ${plan.from})`) : ''}${plan.skipped ? fmt.dim(`, ${plan.skipped} entr(ies) skipped as not facts`) : ''}`)
        out(fmt.dim(`source recorded on every claim: ${vendor.kind}/${vendor.name}\n`))
        for (const [ns, entries] of Object.entries(plan.byNamespace)) {
          out(`${fmt.bold(ns)} ${fmt.dim(`— ${entries.length} claim(s)`)}`)
          for (const { item } of entries.slice(0, 8)) out(`  + ${item.subject ? fmt.bold(item.subject) + fmt.dim(' — ') : ''}${item.claim}${item.topic ? fmt.dim(`  [${item.topic}]`) : ''}`)
          if (entries.length > 8) out(fmt.dim(`  … and ${entries.length - 8} more`))
        }
        if (!v.apply) { out(fmt.dim('\ndry run — nothing written. Re-run with --apply to import.')); return }
        for (const [ns, entries] of Object.entries(plan.byNamespace)) {
          if (!RepoStore.exists(repoPath(ns))) {
            const key = Buffer.from(generateContentKey()).toString('hex')
            Repository.init(ns, owner ?? ns, { contentKey: key, readers: 'key', kind: 'personal', title: ns.split('.')[0]!.replace(/^./, (c) => c.toUpperCase()) })
            out(fmt.ok(`created ${ns}`) + fmt.warn(`  key: 0x${key}  (keep this — readers need it)`))
          }
          // Act as whoever owns this namespace unless told otherwise: an existing
          // namespace may have been created under its own name, and importing your
          // own memories into your own namespace must not depend on that detail.
          const opened = Repository.open(ns)
          const r = actAs(opened, v.as ?? (opened.roles(owner ?? '').includes('owner') ? owner : opened.policy.owner))
          const entriesForNs = entries.map(({ item, memory }) => ({ item: { ...item, contributor: r.identity }, memory }))
          const res = applyImport(r, entriesForNs, vendor)
          const where = res.proposal ? `proposal #${res.proposal.number} (${res.proposal.status})` : `committed ${shortId(res.commit!)}`
          out(`${fmt.ok('✓')} ${ns}: ${res.items.length} claim(s) → ${where} — now v${r.version(r.refs.head)}`)
          if (res.proposal?.findings.length) out(fmt.dim('  ' + fmt.findings(res.proposal.findings).replace(/\n/g, '\n  ')))
        }
        out(fmt.dim('\nThese claims are yours now: a name you own, a version per change, every one citing the export it came from.'))
        return
      }
      const repo = repoArg()
      if (args[0] !== 'wikipedia' || !args[1]) throw new Error('usage: knowledge import wikipedia "<article title>" [--topic t] [--subject s] [--limit 6]')
      const title = args.slice(1).join(' ')
      out(fmt.dim(`fetching Wikipedia summary for "${title}"…`))
      const r = await importWikipedia(repo, title, { ...(v.topic !== undefined ? { topic: v.topic } : {}), ...(v.subject ? { subject: v.subject } : {}), ...(limit ? { limit } : {}) })
      out(`${fmt.ok('✓')} ${r.items.length} claim(s) from ${fmt.bold(r.source.name!)} → proposal ${fmt.bold(`#${r.proposal.number}`)} on ${repo.namespace} (${r.proposal.status})`)
      for (const k of r.items) out(`  + ${k.claim}`)
      out(fmt.findings(r.proposal.findings))
      out(fmt.dim(`review with: knowledge review ${r.proposal.number}`))
      return
    }

    case 'push': {
      const repo = repoArg()
      if (v['if-due']) { const d = repo.publishDue(); if (!d.due) return out(fmt.dim(`not due: ${d.reason}`)) }
      const r = await remoteFor(repo).push()
      if (v.json) return json({ ...r, pushed: r.pushed.map((c) => c.id) })
      if (r.noop) return out(fmt.dim('Everything up-to-date'))
      out(`${fmt.ok('✓')} published ${repo.namespace} v${repo.version(repo.refs.head)} — ${r.pushed.length} new commit(s)`)
      out(fmt.dim(`  refs:        ${r.refsRef.ref}\n  contenthash: ${r.contenthash}${r.receipt ? `\n  tx:          ${r.receipt}` : ''}`))
      return
    }

    case 'pull': {
      const repo = repoArg(); const r = await remoteFor(repo).pull()
      if (v.json) return json({ ...r, fetched: r.fetched.map((c) => c.id) })
      if (!r.remote) return out(fmt.dim(`${repo.namespace} has nothing published yet`))
      out(`${fmt.ok('✓')} fetched ${r.fetched.length} commit(s) — ${repo.namespace} is at v${repo.version(repo.refs.head)}${r.publishedAt ? fmt.dim(`, published ${ago(r.publishedAt)} (a snapshot; unpublished commits may exist on the owner's machine)`) : ''}`)
      if (r.fastForwarded.length) out(`  fast-forwarded: ${r.fastForwarded.join(', ')}`)
      if (r.created.length) out(`  new branches:   ${r.created.join(', ')}`)
      if (r.diverged.length) out(fmt.warn(`  diverged (merge by hand): ${r.diverged.join(', ')}`))
      return
    }

    case 'offer': {
      const repo = repoArg()
      if (!v.price || !v['pay-to'] || !v.endpoint) throw new Error('usage: knowledge offer --price 0.01 --pay-to 0x… --endpoint <url> [--chain eip155:84532] [--epoch-days 7]')
      if (!/^0x[0-9a-fA-F]{40}$/.test(v['pay-to'])) throw new Error('--pay-to must be an address')
      const offer: AccessOffer = {
        role: (v.role as 'read' | 'propose' | undefined) ?? 'read',
        price: v.price.startsWith('$') ? v.price : `$${v.price}`,
        network: v.chain ?? 'eip155:84532', asset: 'USDC', payTo: v['pay-to'] as Hex,
        endpoint: v.endpoint, epochDays: v['epoch-days'] ? Number(v['epoch-days']) : 7,
        ...(v.description ? { description: v.description } : {}),
      }
      const m = await setOffers(repo, network(), [offer])
      if (v.json) return json(m)
      out(`${fmt.ok('✓')} ${repo.namespace} sells ${offer.role} access for ${offer.price} ${offer.asset} on ${offer.network}, per ${offer.epochDays}-day epoch`)
      out(fmt.dim(`  pay to ${offer.payTo} at ${offer.endpoint}\n  this epoch ends ${epochEnd(offer.epochDays)}`))
      return
    }

    case 'access': {
      const repo = repoArg()
      if (args[0] === 'owner') {
        const wallet = walletClient()
        if (!wallet?.account) throw new Error('access owner needs PRIVATE_KEY (the wallet that owns the name)')
        const sig = await wallet.signMessage({ account: wallet.account, message: OWNER_KEY_MESSAGE(repo.namespace) })
        const { pubkey } = ownerKeyFromSignature(sig)
        await grantAccess(repo, network(), { agent: repo.namespace, pubkey, owner: true })
        return out(`${fmt.ok('✓')} sealed ${repo.namespace}'s key to its owner's wallet-derived key`)
      }
      const m = await readManifest(network(), repo.namespace)
      if (v.json) return json(m)
      if (!m) return out(fmt.dim(`${repo.namespace} has no access manifest yet`))
      out(`${repo.namespace}  readers ${m.readers} · key v${m.keyVersion} · ${m.grants.length} grant(s)`)
      for (const o of m.offers ?? []) out(`  offer  ${o.role} · ${o.price} ${o.asset} on ${o.network} · ${o.epochDays}-day epoch · ${o.endpoint}`)
      for (const g of m.grants) out(`  grant  ${g.id} · ${g.agent} · ${g.role}${g.owner ? ' · owner' : ''}${g.validUntil ? ` · until ${g.validUntil.slice(0, 10)}` : ''}${g.payment ? fmt.dim(` · paid ${g.payment.amount} ${g.payment.asset} by ${g.payment.payer.slice(0, 10)}…`) : ''}`)
      return
    }

    case 'rotate': {
      const repo = repoArg()
      const m = await rotateEpoch(repo, network())
      if (!m) return out(fmt.dim('no paid grant has expired; nothing to re-key'))
      out(`${fmt.ok('✓')} re-keyed ${repo.namespace} to key v${m.keyVersion}; ${m.grants.length} grant(s) carry on`)
      return
    }

    default:
      throw new Error(`unknown command "${cmd}"\n\n${HELP}`)
  }
}

main().catch((e: unknown) => { console.error(`error: ${e instanceof Error ? e.message : String(e)}`); process.exit(1) })
