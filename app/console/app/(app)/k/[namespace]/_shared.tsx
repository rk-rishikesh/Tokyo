import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui'
import { defaultBranch, loadRepo, openProposals, snapshotOf, versionOf, type RepoView } from '@/lib/repoview'
import { RepoNav, type RepoTab } from '@/components/RepoNav'

export type Params = Promise<{ namespace: string; id?: string; n?: string }>
export type Query = Promise<Record<string, string | string[] | undefined>>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
export const ago = (iso: string) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60_000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago` }

export async function load(params: Params, searchParams?: Query) {
  const { namespace: raw, id, n } = await params
  const namespace = decodeURIComponent(raw)
  const sp = searchParams ? await searchParams : {}
  const q = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, one(v)]))
  const view = await loadRepo(namespace)
  if (!view) notFound()
  const branch = q.branch && q.branch in view.refs.branches ? q.branch : defaultBranch(view)
  return { view, branch, q, ...(id ? { id: decodeURIComponent(id) } : {}), ...(n ? { n: decodeURIComponent(n) } : {}) }
}

export function SourceBadge({ view }: { view: RepoView }) {
  return view.source === 'ens' ? <Badge tone="added">published · ENS + IPFS</Badge> : <Badge tone="warn">local · not published yet</Badge>
}

/** The namespace header, GitHub + Wikipedia style, shared by every tab. */
export function NamespaceHeader({ view, branch, active }: { view: RepoView; branch: string; active: RepoTab }) {
  const main = defaultBranch(view)
  const version = versionOf(view, main)
  const items = Object.keys(snapshotOf(view, main)).length
  const contributors = new Set(Object.values(snapshotOf(view, main)).map((k) => k.contributor)).size
  const open = openProposals(view).length
  const parent = view.refs.parent
  return (
    <>
      <header className="mb-6">
        <p className="text-[13.5px] text-muted-foreground">
          {parent ? <><Link href={`/k/${encodeURIComponent(parent)}`} className="text-accent hover:underline">{parent}</Link> / </> : null}knowledge namespace
        </p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-mono text-2xl font-semibold tracking-tight">{view.namespace}</h1>
            {view.refs.title ? <p className="mt-1 text-lg">{view.refs.title}</p> : null}
            {view.refs.description ? <p className="mt-1 max-w-2xl text-[15px] text-muted-foreground">{view.refs.description}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[13.5px] text-muted-foreground">
            <SourceBadge view={view} />
            <Badge>{view.refs.policy.kind}</Badge>
            <Badge>{view.refs.policy.readers === 'public' ? 'plaintext' : 'encrypted'}</Badge>
            {view.refs.policy.approvals === 0 ? <Badge tone="warn">auto-land · findings recorded</Badge> : <Badge tone="added">review gated · {view.refs.policy.approvals} approval{view.refs.policy.approvals === 1 ? '' : 's'}</Badge>}
          </div>
        </div>
        <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-[15px]">
          <div><dt className="inline text-muted-foreground">Owner </dt><dd className="inline font-mono">{view.refs.policy.owner}</dd></div>
          <div><dt className="inline text-muted-foreground">Contributors </dt><dd className="inline font-semibold">{contributors}</dd></div>
          <div><dt className="inline text-muted-foreground">Version </dt><dd className="inline font-mono font-semibold">v{version}</dd></div>
          <div><dt className="inline text-muted-foreground">Knowledge </dt><dd className="inline font-semibold">{items}</dd></div>
          <div><dt className="inline text-muted-foreground">Published </dt><dd className="inline">{view.source === 'ens' ? <>{ago(view.refs.updatedAt)}{view.pendingCommits ? <span className="text-warn"> · {view.pendingCommits} commit{view.pendingCommits === 1 ? '' : 's'} not yet published</span> : null}</> : <span className="text-warn">never — local only</span>}</dd></div>
          {view.refs.children.length ? <div><dt className="inline text-muted-foreground">Children </dt><dd className="inline">{view.refs.children.map((c) => <Link key={c} href={`/k/${encodeURIComponent(c)}`} className="mr-2 font-mono text-accent hover:underline">{c}</Link>)}</dd></div> : null}
        </dl>
      </header>
      <RepoNav namespace={view.namespace} active={active} branch={branch !== main ? branch : undefined} counts={{ knowledge: items, branches: Object.keys(view.refs.branches).length, reviews: open, findings: Object.keys(view.refs.findings ?? {}).length, history: Object.keys(view.commits).length }} />
    </>
  )
}

export function BranchPicker({ view, branch, path }: { view: RepoView; branch: string; path: string }) {
  if (Object.keys(view.refs.branches).length < 2) return null
  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5 text-[13.5px]">
      <span className="text-muted-foreground">branch:</span>
      {Object.keys(view.refs.branches).sort().map((b) => (
        <Link key={b} href={`/k/${encodeURIComponent(view.namespace)}${path}?branch=${encodeURIComponent(b)}`} className={`rounded-full border px-2.5 py-0.5 font-mono ${b === branch ? 'border-accent bg-accent/10 text-accent' : 'border-border text-muted-foreground hover:text-foreground'}`}>{b}</Link>
      ))}
    </div>
  )
}
