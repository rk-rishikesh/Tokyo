import Link from 'next/link'
import { Badge, Card, Empty, PageHeader } from '@/components/ui'
import { loadAll, proposalsAcross } from '@/lib/repoview'
import { STATUS_TONE } from '@/lib/status'

export const dynamic = 'force-dynamic'

const STEPS = [
  ['Select namespace', 'knowledge init cancer-research.eth && knowledge pull'],
  ['Add knowledge on a branch', 'knowledge checkout add-olaparib -b --as you.eth\nknowledge add "…" --subject Olaparib --topic approvals --as you.eth'],
  ['Attach a source', '--source document:"FDA approval, December 2014"\n--source paper:"<title>":<doi>\n--source api:ClinicalTrials.gov:<NCT id>'],
  ['Submit a proposal', 'knowledge commit -m "Add olaparib approval" --as you.eth\nknowledge propose --title "Add olaparib approval" --as you.eth'],
  ['Review', 'automated findings → a reviewer approves or rejects'],
  ['Commit', 'knowledge land <n>  →  vN+1, reviewers stamped on your claims'],
]

export default async function Contributions() {
  const views = await loadAll()
  const all = proposalsAcross(views)
  return (
    <>
      <PageHeader title="Contributions" subtitle="Every contribution is a proposal, never an overwrite. It carries your name and your sources for as long as the claim exists." />
      <div className="mb-8 grid gap-3 md:grid-cols-3 lg:grid-cols-6">
        {STEPS.map(([t, c], i) => <Card key={t} className="p-3"><p className="text-[13.5px] text-muted-foreground">{i + 1}</p><p className="text-[15px] font-medium">{t}</p><pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-[12px] leading-snug text-muted-foreground"><code>{c}</code></pre></Card>)}
      </div>
      <p className="mb-6 text-[15px]">Agents contribute the same way: <code className="rounded bg-muted px-1">knowledge_propose({'{ namespace, title, items }'})</code>. Applications: <code className="rounded bg-muted px-1">Namespace.for(name).contribute(…)</code>. See <Link href="/roles/contributor" className="text-accent hover:underline">the contributor guide</Link>.</p>
      <h2 className="mb-3 text-[15px] font-medium">Recent contributions across the network</h2>
      {all.length ? (
        <div className="space-y-2">
          {all.map(({ view, proposal: p }) => (
            <Link key={`${view.namespace}${p.id}`} href={`/k/${encodeURIComponent(view.namespace)}/reviews/${p.number}`} className="block">
              <Card className="flex flex-wrap items-center gap-3 p-4 transition-colors hover:border-accent/50">
                <span className="font-mono text-[13.5px] text-muted-foreground">{view.namespace} #{p.number}</span>
                <span className="text-[15px] font-medium">{p.title}</span>
                <Badge tone={STATUS_TONE[p.status]}>{p.status.replace('-', ' ')}</Badge>
                <span className="ml-auto text-[13.5px] text-muted-foreground">by {p.author} · {p.updatedAt.slice(0, 10)}</span>
              </Card>
            </Link>
          ))}
        </div>
      ) : <Empty>No contributions yet.</Empty>}
    </>
  )
}
