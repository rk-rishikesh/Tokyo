import Link from 'next/link'
import { Badge, Card, Empty } from '@/components/ui'
import { CommitRow } from '@/components/CommitRow'
import { NamespaceHeader, load, type Params } from '../_shared'

export const dynamic = 'force-dynamic'

const TONE = { duplicate: 'warn', contradiction: 'removed', supersession: 'added', 'missing-sources': 'warn', 'low-confidence': 'warn', 'unsupported-change': 'removed', removal: 'removed' } as const

/** The review-later queue (PRD W2): findings on commits that landed without a gate. */
export default async function Findings({ params }: { params: Params }) {
  const { view, branch } = await load(params)
  const base = `/k/${encodeURIComponent(view.namespace)}`
  const rows = Object.entries(view.refs.findings ?? {}).map(([id, fs]) => ({ commit: view.commits[id], findings: fs })).filter((r) => r.commit).sort((a, b) => b.commit!.timestamp.localeCompare(a.commit!.timestamp))
  return (
    <>
      <NamespaceHeader view={view} branch={branch} active="findings" />
      <p className="mb-4 max-w-3xl text-[15px] text-muted-foreground">
        {view.refs.policy.approvals === 0
          ? <>This namespace auto-lands (<code>approvals: 0</code>): writes are not gated, so review runs afterwards and records what it found here. Nothing is lost — resolve when you have looked.</>
          : <>Direct commits by the owner or a reviewer skip the proposal gate; automated review still runs on them and records findings here.</>}
      </p>
      {rows.length ? (
        <div className="space-y-3">
          {rows.map(({ commit, findings }) => (
            <Card key={commit!.id} className="p-4">
              <ul><CommitRow c={commit!} namespace={view.namespace} /></ul>
              <ul className="mt-1 space-y-1.5 text-[15px]">
                {findings.map((f, i) => <li key={i} className="flex gap-2"><Badge tone={TONE[f.kind]}>{f.kind.replace('-', ' ')}{f.blocking ? ' · blocking' : ''}</Badge><span className="text-[14.5px]">{f.message}{f.related ? <> <Link href={`${base}/item/${encodeURIComponent(f.related)}`} className="text-accent hover:underline">view related</Link></> : null}</span></li>)}
              </ul>
              <code className="mt-3 block rounded-md border border-border bg-muted px-2 py-1 font-mono text-[12.5px]">knowledge findings --resolve {commit!.id.slice(0, 7)} -n {view.namespace}</code>
            </Card>
          ))}
        </div>
      ) : <Empty>No unresolved findings — every ungated commit was clean.</Empty>}
    </>
  )
}
