import Link from 'next/link'
import { Card, Empty } from '@/components/ui'
import { KnowledgeCard } from '@/components/KnowledgeCard'
import { outline, searchOf, snapshotOf, openProposals, logOf, versionOf, defaultBranch } from '@/lib/repoview'
import { BranchPicker, NamespaceHeader, load, type Params, type Query } from './_shared'
import { Arrow } from '@/components/Arrow'

export const dynamic = 'force-dynamic'

/** The Knowledge tab: the namespace as an outline (topic → subject → claims), searchable. */
export default async function KnowledgeTab({ params, searchParams }: { params: Params; searchParams: Query }) {
  const { view, branch, q } = await load(params, searchParams)
  const snapshot = snapshotOf(view, branch)
  const query = q.q?.trim() ?? ''
  const topic = q.topic
  const base = `/k/${encodeURIComponent(view.namespace)}`
  const hits = query ? searchOf(view, branch, query, topic || undefined).map((h) => h.knowledge) : null
  const tree = outline(snapshot).filter((t) => topic === undefined || t.topic === topic)
  const open = openProposals(view)
  const latest = logOf(view, defaultBranch(view), 1)[0]
  const refsUrl = view.refsRef ? view.gatewayUrl(view.refsRef) : null

  return (
    <>
      <NamespaceHeader view={view} branch={branch} active="knowledge" />
      <BranchPicker view={view} branch={branch} path="" />

      <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
        <div>
          <form action={base} method="get" className="mb-4 flex flex-wrap gap-2">
            {branch !== defaultBranch(view) ? <input type="hidden" name="branch" value={branch} /> : null}
            <input name="q" defaultValue={query} placeholder={`search ${view.namespace}…`} className="min-w-[14rem] flex-1 rounded-md border border-border bg-card px-3 py-1.5 text-[15px]" />
            <button className="rounded-md bg-ink px-3 py-1.5 text-[15px] text-bg">search</button>
          </form>

          {hits ? (
            hits.length ? <div className="space-y-3">{hits.map((k) => <KnowledgeCard key={k.id} k={k} namespace={view.namespace} branch={branch} />)}</div> : <Empty>No knowledge matches “{query}”.</Empty>
          ) : tree.length ? (
            <div className="space-y-8">
              {tree.map((t) => (
                <section key={t.topic}>
                  <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold"><span className="font-mono text-muted-foreground">{t.topic || 'general'}</span><span className="text-[13.5px] text-muted-foreground">{t.subjects.reduce((n, s) => n + s.items.length, 0)}</span></h2>
                  <div className="space-y-4">
                    {t.subjects.map((s) => (
                      <div key={s.subject}>
                        {s.subject ? <h3 className="mb-2 text-base font-medium">{s.subject}</h3> : null}
                        <div className="space-y-2">{s.items.map((k) => <KnowledgeCard key={k.id} k={k} namespace={view.namespace} branch={branch} compact />)}</div>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : <Empty>Nothing in this namespace yet{branch !== defaultBranch(view) ? ` on ${branch}` : ''}.</Empty>}
        </div>

        <aside className="space-y-4">
          <Card className="p-4 text-[15px]">
            <h2 className="mb-2 text-[13.5px] font-medium uppercase tracking-wider text-muted-foreground">Topics</h2>
            <ul className="space-y-1">
              <li><Link href={base} className={`hover:underline ${topic === undefined ? 'text-accent' : ''}`}>all</Link></li>
              {outline(snapshot).map((t) => <li key={t.topic} className="flex justify-between"><Link href={`${base}?topic=${encodeURIComponent(t.topic)}`} className={`font-mono hover:underline ${topic === t.topic ? 'text-accent' : ''}`}>{t.topic || 'general'}</Link><span className="text-[13.5px] text-muted-foreground">{t.subjects.reduce((n, s) => n + s.items.length, 0)}</span></li>)}
            </ul>
          </Card>
          <Card className="p-4 text-[15px]">
            <h2 className="mb-2 text-[13.5px] font-medium uppercase tracking-wider text-muted-foreground">Current version</h2>
            {latest ? <><p className="font-mono font-semibold">v{versionOf(view, defaultBranch(view))} <span className="text-[13.5px] font-normal text-muted-foreground">{latest.id.slice(0, 7)}</span></p><p className="mt-1 text-[13.5px] text-muted-foreground">{latest.message} · {latest.author} · {latest.timestamp.slice(0, 10)}</p></> : <p className="text-muted-foreground">no versions yet</p>}
            {open.length ? <p className="mt-2 text-[13.5px]"><Link href={`${base}/reviews`} className="text-accent hover:underline">{open.length} proposal{open.length === 1 ? '' : 's'} awaiting review <Arrow /></Link></p> : null}
          </Card>
          <Card className="p-4 text-[15px]">
            <h2 className="mb-2 text-[13.5px] font-medium uppercase tracking-wider text-muted-foreground">Where it lives</h2>
            <p className="text-[13.5px] text-muted-foreground">ENS <span className="font-mono">{view.namespace}</span></p>
            <p className="mt-1 break-all text-[13.5px] text-muted-foreground">contenthash {view.contenthash ? <span className="font-mono">{view.contenthash.slice(0, 18)}…</span> : '— not published'}</p>
            {view.refsRef ? <p className="mt-1 break-all text-[13.5px]">refs {refsUrl ? <a href={refsUrl} target="_blank" rel="noreferrer" className="font-mono text-accent hover:underline">{view.refsRef.slice(0, 20)}…</a> : <span className="font-mono">{view.refsRef.slice(0, 20)}…</span>}</p> : null}
            <p className="mt-2 text-[13.5px] text-muted-foreground">{view.refs.policy.readers === 'public' ? 'Public: objects are plaintext on IPFS; any agent can read them.' : 'Private: objects are encrypted; readers hold the namespace key.'}</p>
          </Card>
          <Card className="p-4 text-[15px]">
            <h2 className="mb-2 text-[13.5px] font-medium uppercase tracking-wider text-muted-foreground">Use it</h2>
            <pre className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-[12.5px] leading-relaxed"><code>{`knowledge init ${view.namespace}\nknowledge pull\nknowledge search "…"\n\n# agents (MCP)\nknowledge_search({ namespace: "${view.namespace}", query })`}</code></pre>
          </Card>
        </aside>
      </div>
    </>
  )
}
