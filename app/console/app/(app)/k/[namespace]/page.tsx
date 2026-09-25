import Link from 'next/link'
import { Empty } from '@/components/ui'
import { KnowledgeCard } from '@/components/KnowledgeCard'
import { outline, searchOf, snapshotOf, defaultBranch } from '@/lib/repoview'
import { BranchPicker, NamespaceHeader, load, type Params, type Query } from './_shared'

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

  return (
    <>
      <NamespaceHeader view={view} branch={branch} active="knowledge" />
      <BranchPicker view={view} branch={branch} path="" />

      <div>
        <div>
          <form action={base} method="get" className="mb-4 flex flex-wrap gap-2">
            {branch !== defaultBranch(view) ? <input type="hidden" name="branch" value={branch} /> : null}
            <input name="q" defaultValue={query} placeholder={`search ${view.namespace}…`} className="min-w-[14rem] flex-1 rounded-md border border-border bg-card px-3 py-1.5 text-[15px]" />
            <button className="rounded-md bg-ink px-3 py-1.5 text-[15px] text-bg">search</button>
          </form>

          {/* Topics as filters, in line — they used to sit in a sidebar with the version and storage details. */}
          {outline(snapshot).length > 1 ? (
            <div className="mb-6 flex flex-wrap gap-2">
              <Link href={base} className={`rounded-full px-3.5 py-1.5 text-[14px] ${topic === undefined ? 'bg-ink text-bg' : 'border border-line hover:bg-raised'}`}>All</Link>
              {outline(snapshot).map((t) => (
                <Link key={t.topic} href={`${base}?topic=${encodeURIComponent(t.topic)}`} className={`rounded-full px-3.5 py-1.5 text-[14px] ${topic === t.topic ? 'bg-ink text-bg' : 'border border-line hover:bg-raised'}`}>
                  {t.topic || 'general'} <span className="opacity-60">{t.subjects.reduce((n, s) => n + s.items.length, 0)}</span>
                </Link>
              ))}
            </div>
          ) : null}

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

      </div>
    </>
  )
}
