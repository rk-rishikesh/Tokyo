import Link from 'next/link'
import { Badge, Card, Empty } from '@/components/ui'
import { proposalsOf } from '@/lib/repoview'
import { NamespaceHeader, load, type Params, type Query } from '../_shared'

import { STATUS_TONE } from '@/lib/status'

export const dynamic = 'force-dynamic'

export default async function Reviews({ params, searchParams }: { params: Params; searchParams: Query }) {
  const { view, branch, q } = await load(params, searchParams)
  const all = proposalsOf(view)
  const show = q.all ? all : all.filter((p) => !['committed', 'rejected'].includes(p.status))
  const base = `/k/${encodeURIComponent(view.namespace)}/reviews`
  return (
    <>
      <NamespaceHeader view={view} branch={branch} active="reviews" />
      <div className="mb-3 flex gap-3 text-[13.5px]">
        <Link href={base} className={!q.all ? 'text-accent' : 'text-muted-foreground hover:text-foreground'}>open ({all.filter((p) => !['committed', 'rejected'].includes(p.status)).length})</Link>
        <Link href={`${base}?all=1`} className={q.all ? 'text-accent' : 'text-muted-foreground hover:text-foreground'}>all ({all.length})</Link>
      </div>
      {show.length ? (
        <div className="space-y-2">
          {show.map((p) => (
            <Link key={p.id} href={`${base}/${p.number}`} className="block">
              <Card className="flex flex-wrap items-center gap-3 p-4 transition-colors hover:border-accent/50">
                <span className="font-mono text-[15px] text-muted-foreground">#{p.number}</span>
                <span className="text-[15px] font-medium">{p.title}</span>
                <Badge tone={STATUS_TONE[p.status]}>{p.status.replace('-', ' ')}</Badge>
                {p.findings.length ? <Badge tone="warn">{p.findings.length} finding{p.findings.length === 1 ? '' : 's'}</Badge> : <Badge tone="added">no findings</Badge>}
                <span className="ml-auto text-[13.5px] text-muted-foreground">{p.author} · {p.branch} → {p.base} · {new Set(p.reviews.filter((r) => r.verdict === 'approve').map((r) => r.reviewer)).size}/{view.refs.policy.approvals} approvals · {p.createdAt.slice(0, 10)}</span>
              </Card>
            </Link>
          ))}
        </div>
      ) : <Empty>{q.all ? 'No proposals yet.' : 'Nothing awaiting review.'}</Empty>}
      <p className="mt-4 text-[13.5px] text-muted-foreground">Lifecycle: proposed → under review → approved → committed, or rejected (PRD §23). Automated review flags duplicates, contradictions, missing sources and low confidence; a reviewer decides.</p>
    </>
  )
}
