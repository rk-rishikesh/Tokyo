import Link from 'next/link'
import { SOURCE_GLYPH } from '@/lib/glyphs'
import { Badge, Card, Empty, PageHeader } from '@/components/ui'
import { loadAll, sourcesAcross } from '@/lib/repoview'

export const dynamic = 'force-dynamic'


export default async function Sources() {
  const views = await loadAll()
  const rows = sourcesAcross(views)
  return (
    <>
      <PageHeader title="Knowledge sources" subtitle="Where the network’s knowledge comes from. A source connects to one or many namespaces; every claim it contributes keeps the source on it." />
      <div className="mb-6 grid gap-3 sm:grid-cols-5">
        {(['human', 'document', 'api', 'agent', 'application'] as const).map((k) => {
          const n = rows.filter((r) => r.kind === k)
          return <Card key={k} className="p-3"><p className="text-xl grayscale" aria-hidden>{SOURCE_GLYPH[k]}</p><p className="mt-1 text-[13.5px] capitalize text-muted-foreground">{k}</p><p className="font-mono text-lg font-semibold">{n.length}</p><p className="text-[12.5px] text-muted-foreground">{n.reduce((a, r) => a + r.objects, 0)} claims</p></Card>
        })}
      </div>
      <h2 className="mb-3 text-[15px] font-medium">Connected in this network</h2>
      {rows.length ? (
        <div className="space-y-2">
          {rows.map((r) => (
            <Card key={r.id} className="flex flex-wrap items-center gap-3 p-4">
              <span className="text-xl grayscale" aria-hidden>{SOURCE_GLYPH[r.kind]}</span>
              <div className="min-w-0">
                <p className="text-[15px] font-semibold">{r.name} <Badge>{r.kind}</Badge> <Badge tone="added">{r.status}</Badge></p>
                {r.description ? <p className="text-[13.5px] text-muted-foreground">{r.description}</p> : null}
                <p className="mt-1 flex flex-wrap gap-x-2 text-[13.5px] text-muted-foreground">namespaces: {r.namespaces.map((n) => <Link key={n} href={`/k/${encodeURIComponent(n)}`} className="font-mono text-accent hover:underline">{n}</Link>)}</p>
              </div>
              <span className="ml-auto text-[13.5px] text-muted-foreground">{r.objects} knowledge object{r.objects === 1 ? '' : 's'} · since {r.connectedAt.slice(0, 10)}</span>
            </Card>
          ))}
        </div>
      ) : <Empty>No sources connected yet.</Empty>}
      <p className="mt-8 max-w-3xl text-[13.5px] text-muted-foreground">
        Sources are named on every claim, so a reader can weigh it. What a source is <em>not</em>: a feed. A weather forecast, a stock tick or a chat log is not a claim — it has no truth condition a second party would cite. What these connectors contribute is the durable statement underneath: the climate norm, the rebalancing date, the decision the thread reached. That is why an importer reads remembered facts and named decisions rather than transcripts.
      </p>
    </>
  )
}
