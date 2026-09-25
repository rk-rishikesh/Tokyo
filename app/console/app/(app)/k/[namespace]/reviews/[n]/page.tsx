import Link from 'next/link'
import { Badge, Card, Empty, Mono } from '@/components/ui'
import { DiffView } from '@/components/DiffView'
import { diffSnapshots } from '@recall/core'
import { proposalsOf, snapshotOf } from '@/lib/repoview'
import { NamespaceHeader, load, type Params, type Query } from '../../_shared'

import { STATUS_TONE } from '@/lib/status'

export const dynamic = 'force-dynamic'

const FINDING_TONE = { duplicate: 'warn', contradiction: 'removed', supersession: 'added', 'missing-sources': 'warn', 'low-confidence': 'warn', 'unsupported-change': 'removed', removal: 'removed' } as const

export default async function Review({ params, searchParams }: { params: Params; searchParams: Query }) {
  const { view, branch, n } = await load(params, searchParams)
  const p = proposalsOf(view).find((x) => String(x.number) === n)
  const base = `/k/${encodeURIComponent(view.namespace)}`
  return (
    <>
      <NamespaceHeader view={view} branch={branch} active="reviews" />
      {!p ? <Empty>No proposal #{n}.</Empty> : (
        <>
          <p className="mb-2 text-[13.5px]"><Link href={`${base}/reviews`} className="text-accent hover:underline">← reviews</Link></p>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-semibold"><span className="font-mono text-muted-foreground">#{p.number}</span> {p.title}</h2>
            <Badge tone={STATUS_TONE[p.status]}>{p.status.replace('-', ' ')}</Badge>
          </div>
          {p.description ? <p className="mb-4 max-w-3xl text-[15px] text-muted-foreground">{p.description}</p> : null}
          <p className="mb-6 text-[13.5px] text-muted-foreground">{p.author} proposes <span className="font-mono">{p.branch}</span> → <span className="font-mono">{p.base}</span> · opened {p.createdAt.slice(0, 16).replace('T', ' ')} · needs {view.refs.policy.approvals} approval{view.refs.policy.approvals === 1 ? '' : 's'}{p.mergedCommit ? <> · landed as <Link href={`${base}/diff?to=${p.mergedCommit}`} className="text-accent hover:underline"><Mono>{p.mergedCommit.slice(0, 7)}</Mono></Link></> : null}</p>

          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <Card className="p-4">
              <h3 className="mb-3 text-[15px] font-medium">Proposed changes</h3>
              <DiffView diff={diffSnapshots(snapshotOf(view, p.base), snapshotOf(view, p.branch))} />
              {p.status === 'committed' ? <p className="mt-3 text-[13.5px] text-muted-foreground">Shown as the branch stands now; the landed version is in the history.</p> : null}
            </Card>
            <div className="space-y-4">
              <Card className="p-4">
                <h3 className="mb-2 text-[15px] font-medium">Automated review</h3>
                {p.findings.length ? (
                  <ul className="space-y-2 text-[15px]">{p.findings.map((f, i) => <li key={i} className="flex gap-2"><Badge tone={FINDING_TONE[f.kind]}>{f.kind.replace('-', ' ')}</Badge><span className="text-[14.5px]">{f.message}{f.related ? <> <Link href={`${base}/item/${encodeURIComponent(f.related)}`} className="text-accent hover:underline">view existing</Link></> : null}</span></li>)}</ul>
                ) : <p className="text-[15px] text-muted-foreground">No findings.</p>}
                <p className="mt-3 text-[13.5px] text-muted-foreground">Advisory. Detects duplicates, contradictions, supersessions (a fact that changed, marked <code>supersedes</code>), missing sources, low confidence and removals against the current base. Blocking findings stop auto-land; a person or the policy decides.</p>
              </Card>
              <Card className="p-4">
                <h3 className="mb-2 text-[15px] font-medium">Reviews</h3>
                {p.reviews.length ? (
                  <ul className="space-y-2 text-[15px]">{p.reviews.map((r, i) => <li key={i}><span className={r.verdict === 'approve' ? 'text-added' : r.verdict === 'reject' ? 'text-removed' : 'text-muted-foreground'}>{r.verdict === 'approve' ? '✓ approved' : r.verdict === 'reject' ? '✗ rejected' : '· commented'}</span> by <span className="font-mono">{r.reviewer}</span>{r.verdict === 'approve' ? <> {r.signature ? (r.verified ? <Badge tone="added">verified · signed by the name’s owner</Badge> : r.verified === false ? <Badge tone="removed">signature does not match the name’s owner</Badge> : <Badge tone="warn">signed · not yet verified</Badge>) : <Badge tone="warn">claimed · unsigned</Badge>}</> : null}{r.comment ? <p className="mt-0.5 text-[14.5px] text-muted-foreground">“{r.comment}”</p> : null}<p className="text-[12.5px] text-muted-foreground">{r.at.slice(0, 16).replace('T', ' ')}</p></li>)}</ul>
                ) : <p className="text-[15px] text-muted-foreground">No reviews yet.</p>}
                <pre className="mt-3 overflow-x-auto rounded-md bg-muted p-2 font-mono text-[12.5px] leading-relaxed"><code>{`knowledge review ${p.number} --approve --sign -m "…"   # --sign: EIP-191 with the key that owns your name\nknowledge land ${p.number}                          # verifies signatures against ENS owners`}</code></pre>
                <p className="mt-2 text-[12.5px] text-muted-foreground">An unsigned approval is a claim by whoever ran the command. A signed one is checked at land against the address that owns the reviewer’s ENS name. This namespace {view.refs.policy.signedApprovals ? 'requires' : 'does not require'} signed approvals.</p>
              </Card>
            </div>
          </div>
        </>
      )}
    </>
  )
}
