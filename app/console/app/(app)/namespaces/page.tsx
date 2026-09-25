import Link from 'next/link'
import { Badge, Card, Empty, PageHeader } from '@/components/ui'
import { defaultBranch, knownNamespaces, loadAll, openProposals, snapshotOf, tree, versionOf, type Tree } from '@/lib/repoview'

export const dynamic = 'force-dynamic'

function Node({ t, depth }: { t: Tree; depth: number }) {
  if (!t.view) {
    // A name that groups namespaces but holds no claims itself.
    return (
      <div className="space-y-2">
        <div style={{ marginLeft: depth * 28 }} className="flex items-start gap-2">
          {depth > 0 ? <span className="mt-4 font-mono text-muted-foreground">└─</span> : null}
          <div className="flex flex-1 flex-wrap items-center gap-3 rounded-[22px] bg-raised p-4">
            <span className="font-mono text-[15px] font-semibold">{t.name}</span>
            <span className="ml-auto text-[13.5px] text-dim">{t.children.length} namespace{t.children.length === 1 ? '' : 's'} under it</span>
          </div>
        </div>
        {t.children.map((c) => <Node key={c.name} t={c} depth={depth + 1} />)}
      </div>
    )
  }
  const v = t.view; const b = defaultBranch(v); const open = openProposals(v).length
  const sources = Object.values(v.refs.sources ?? {})
  return (
    <div className="space-y-2">
      <div style={{ marginLeft: depth * 28 }} className="flex items-start gap-2">
        {depth > 0 ? <span className="mt-4 font-mono text-muted-foreground">└─</span> : null}
        <Link href={`/k/${encodeURIComponent(v.namespace)}`} className="block flex-1">
          <Card className="flex flex-wrap items-center gap-3 p-4 transition-colors hover:border-accent/50">
            <span className="font-mono text-[15px] font-semibold">{v.namespace}</span>
            {v.refs.title ? <span className="text-[15px]">{v.refs.title}</span> : null}
            {v.source === 'ens' ? <Badge tone="added">published</Badge> : <Badge tone="warn">local only</Badge>}
            <Badge>{v.refs.policy.readers === 'public' ? 'public' : 'private'}</Badge>
            {sources.length ? <span className="text-[13.5px] text-muted-foreground">sources: {sources.map((s) => s.name).join(', ')}</span> : null}
            <span className="ml-auto text-[13.5px] text-muted-foreground">v{versionOf(v, b)} · {Object.keys(snapshotOf(v, b)).length} objects · owner {v.refs.policy.owner}{open ? ` · ${open} pending review` : ''}</span>
          </Card>
        </Link>
      </div>
      {t.children.map((c) => <Node key={c.name} t={c} depth={depth + 1} />)}
    </div>
  )
}

export default async function Namespaces() {
  const views = await loadAll()
  const roots = tree(views)
  const missing = knownNamespaces().filter((n) => !views.some((v) => v.namespace === n))
  return (
    <>
      <PageHeader title="Knowledge network" subtitle="Namespaces this explorer can read, as a hierarchy. Each is an ENS name whose contenthash points at a versioned, reviewed body of knowledge with its own owner, policy and sources." />
      {roots.length ? <div className="space-y-3">{roots.map((t) => <Node key={t.name} t={t} depth={0} />)}</div>
        : <Empty>No namespaces. Set <code>NEXT_PUBLIC_KNOWLEDGE_NAMESPACES=worldhistory.eth</code> or run <code>knowledge init worldhistory.eth</code> on this machine.</Empty>}
      {missing.length ? <p className="mt-4 text-[13.5px] text-muted-foreground">Configured but unreadable here: {missing.join(', ')}</p> : null}
      <p className="mt-6 text-[13.5px] text-muted-foreground">Browse · search · resolve · inspect · compare versions · inspect sources · inspect contributors — open a namespace.</p>
    </>
  )
}
