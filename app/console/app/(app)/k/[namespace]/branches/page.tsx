import Link from 'next/link'
import { Badge, Card, Mono } from '@/components/ui'
import { aheadBehind, defaultBranch, proposalsOf } from '@/lib/repoview'
import { NamespaceHeader, load, type Params } from '../_shared'
import { Arrow } from '@/components/Arrow'

export const dynamic = 'force-dynamic'

export default async function Branches({ params }: { params: Params }) {
  const { view, branch } = await load(params)
  const main = defaultBranch(view)
  const base = `/k/${encodeURIComponent(view.namespace)}`
  const byBranch = new Map(proposalsOf(view).map((p) => [p.branch, p]))
  const rows = Object.entries(view.refs.branches).sort(([a], [b]) => (a === main ? -1 : b === main ? 1 : a.localeCompare(b)))
  return (
    <>
      <NamespaceHeader view={view} branch={branch} active="branches" />
      <div className="space-y-3">
        {rows.map(([name, id]) => {
          const c = view.commits[id]; const ab = aheadBehind(view, name, main); const p = byBranch.get(name)
          return (
            <Card key={name} className="flex flex-wrap items-center gap-3 p-4">
              <Link href={`${base}?branch=${encodeURIComponent(name)}`} className="font-mono text-[15px] font-semibold text-accent hover:underline">{name}</Link>
              {name === main ? <Badge tone="accent">default</Badge> : null}
              {p ? <Link href={`${base}/reviews/${p.number}`}><Badge tone={p.status === 'committed' ? 'added' : p.status === 'rejected' ? 'removed' : 'warn'}>#{p.number} {p.status}</Badge></Link> : null}
              <Mono>{id.slice(0, 7)}</Mono>
              <span className="text-[15px] text-muted-foreground">{c?.message ?? 'unknown commit'}</span>
              <span className="ml-auto flex items-center gap-3 text-[13.5px] text-muted-foreground">
                {name !== main ? <span><span className="text-added">{ab.ahead} ahead</span> · <span className="text-removed">{ab.behind} behind</span> {main}</span> : null}
                {name !== main ? <Link href={`${base}/diff?from=${encodeURIComponent(main)}&to=${encodeURIComponent(name)}`} className="text-accent hover:underline">diff vs {main} <Arrow /></Link> : null}
                <span>{c ? `${Object.keys(c.snapshot).length} objects` : ''}</span>
              </span>
            </Card>
          )
        })}
      </div>
      <p className="mt-4 text-[13.5px] text-muted-foreground">Branches carry contributions, hypotheses and alternative interpretations (PRD §12). A branch reaches {main} through a proposal and a review, or — for owners and reviewers — a direct merge.</p>
    </>
  )
}
