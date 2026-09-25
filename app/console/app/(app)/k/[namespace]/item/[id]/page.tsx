import Link from 'next/link'
import { Card, Empty, Mono } from '@/components/ui'
import { KnowledgeCard, SourceList } from '@/components/KnowledgeCard'
import { CommitRow } from '@/components/CommitRow'
import { snapshotOf, whyOf, proposalsOf, versionOf, defaultBranch, versionNumber, supersessionOf, retiredClaim } from '@/lib/repoview'
import { ProvenancePanel } from '@/components/Provenance'
import { NamespaceHeader, load, type Params, type Query } from '../../_shared'

export const dynamic = 'force-dynamic'

/** One knowledge item, PRD §22: claim, sources, contributors, reviewers, history. */
export default async function Item({ params, searchParams }: { params: Params; searchParams: Query }) {
  const { view, branch, id } = await load(params, searchParams)
  const live = id ? snapshotOf(view, branch)[id] : undefined
  const retired = !live && id ? retiredClaim(view, branch, id) : undefined
  const k = live ?? retired
  const p = id && live ? whyOf(view, branch, id) : undefined
  const chain = id ? supersessionOf(view, branch, id) : { replaced: [], replacedBy: [] }
  const base = `/k/${encodeURIComponent(view.namespace)}`
  const proposalByCommit = new Map(proposalsOf(view).filter((x) => x.mergedCommit).map((x) => [x.mergedCommit!, x.number]))
  return (
    <>
      <NamespaceHeader view={view} branch={branch} active="knowledge" />
      {k && !live ? (
        <Card className="mb-4 border-warn/40 bg-warn-bg p-4 text-[15px]">
          <p className="font-medium">Retired claim — no longer in the current version, kept in history.</p>
          <p className="mt-1">{k.subject ? <span className="font-medium">{k.subject}: </span> : null}<span className="line-through opacity-70">{k.claim}</span></p>
          {chain.replacedBy.length ? <p className="mt-2 text-[13.5px]">Superseded by {chain.replacedBy.map((r) => <Link key={r.id} href={`${base}/item/${encodeURIComponent(r.id)}?branch=${branch}`} className="text-accent hover:underline">“{r.claim}”</Link>)}</p> : <p className="mt-2 text-[13.5px] text-muted-foreground">Removed or reverted; see <Link href={`${base}/history?branch=${branch}`} className="text-accent hover:underline">history</Link>.</p>}
        </Card>
      ) : null}
      {!k || !p ? (!k ? <Empty>No knowledge <Mono>{id}</Mono> on {branch}.</Empty> : null) : (
        <>
          <p className="mb-3 text-[13.5px] text-muted-foreground"><Link href={base} className="text-accent hover:underline">Knowledge</Link>{k.topic ? <> / <Link href={`${base}?topic=${encodeURIComponent(k.topic)}`} className="text-accent hover:underline">{k.topic}</Link></> : null}{k.subject ? <> / {k.subject}</> : null}</p>
          <KnowledgeCard k={k} namespace={view.namespace} branch={branch} />
          <div className="mt-4">
            <ProvenancePanel k={k} p={p} namespace={view.namespace} open
              version={versionOf(view, defaultBranch(view))}
              introducedVersion={p.introduced ? versionNumber(view, p.lastChanged?.id ?? p.introduced.id) : undefined}
              cid={p.lastChanged ? view.refs.objects[p.lastChanged.id] : undefined}
              gatewayUrl={p.lastChanged && view.refs.objects[p.lastChanged.id] ? view.gatewayUrl(view.refs.objects[p.lastChanged.id]!) : null} />
          </div>
          {chain.replaced.length || chain.replacedBy.length ? (
            <Card className="mt-4 p-4 text-[15px]">
              <h2 className="mb-2 font-medium">Supersession chain</h2>
              <ol className="space-y-1">
                {[...chain.replaced].reverse().map((r) => <li key={r.id} className="flex gap-2 text-muted-foreground"><span>↑</span><Link href={`${base}/item/${encodeURIComponent(r.id)}?branch=${branch}`} className="line-through hover:underline">{r.claim}</Link><span className="text-[13.5px]">(retired)</span></li>)}
                <li className="flex gap-2 font-medium"><span>●</span>{k.claim}<span className="text-[13.5px] text-muted-foreground">(current)</span></li>
                {chain.replacedBy.map((r) => <li key={r.id} className="flex gap-2"><span>↓</span><Link href={`${base}/item/${encodeURIComponent(r.id)}?branch=${branch}`} className="text-accent hover:underline">{r.claim}</Link></li>)}
              </ol>
              <p className="mt-2 text-[13.5px] text-muted-foreground">A supersession is a fact that changed — the old value is retired and kept, not overwritten. A contradiction is a disagreement and goes to review.</p>
            </Card>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2 text-[15px]">
            <Link href={`${base}/history`} className="rounded-md border border-border px-3 py-1.5 hover:bg-muted">View history</Link>
            <Link href="#sources" className="rounded-md border border-border px-3 py-1.5 hover:bg-muted">View sources</Link>
            {p.introduced ? <Link href={`${base}/diff?from=${p.introduced.parents[0] ?? ''}&to=${p.introduced.id}`} className="rounded-md border border-border px-3 py-1.5 hover:bg-muted">View diff</Link> : null}
          </div>
          <div id="sources" className="mt-4 grid gap-4 md:grid-cols-2">
            <Card className="p-4 text-[15px]">
              <h2 className="mb-3 font-medium">Provenance</h2>
              <dl className="space-y-2">
                <Row label="sources"><SourceList sources={k.sources} /></Row>
                <Row label="contributor">{k.contributor}</Row>
                <Row label="reviewed by">{k.reviewers.length ? k.reviewers.join(', ') : <span className="text-warn">nobody yet</span>}</Row>
                <Row label="confidence">{Math.round(k.confidence * 100)}%</Row>
                <Row label="added">{p.introduced?.timestamp ?? k.created_at}</Row>
                {k.updated_at ? <Row label="last updated">{k.updated_at}</Row> : null}
                <Row label="introduced in">{p.introduced ? <Link className="text-accent hover:underline" href={`${base}/diff?from=${p.introduced.parents[0] ?? ''}&to=${p.introduced.id}`}><Mono>{p.introduced.id.slice(0, 7)}</Mono> {p.introduced.message}</Link> : '—'}</Row>
                <Row label="revisions">{p.history.length}</Row>
              </dl>
            </Card>
            <Card className="p-4">
              <h2 className="mb-1 text-[15px] font-medium">Every version that touched it</h2>
              <ul>{p.history.map((c) => <CommitRow key={c.id} c={c} namespace={view.namespace} proposalNumber={proposalByCommit.get(c.id)} />)}</ul>
            </Card>
          </div>
        </>
      )}
    </>
  )
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="grid grid-cols-[8rem_1fr] gap-2"><dt className="text-muted-foreground">{label}</dt><dd className="min-w-0 break-words">{children}</dd></div>
}
