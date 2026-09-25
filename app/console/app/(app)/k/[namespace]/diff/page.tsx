import { Card, Mono } from '@/components/ui'
import { DiffView } from '@/components/DiffView'
import { diffSnapshots } from '@knowledge01/core'
import { defaultBranch, logOf, resolveVersion } from '@/lib/repoview'
import { NamespaceHeader, load, type Params, type Query } from '../_shared'

export const dynamic = 'force-dynamic'

export default async function Diff({ params, searchParams }: { params: Params; searchParams: Query }) {
  const { view, branch, q } = await load(params, searchParams)
  const main = defaultBranch(view)
  const branches = Object.keys(view.refs.branches).sort()
  const line = logOf(view, main, 200)
  const from = q.from ?? (line.length > 1 ? `v${line.length - 1}` : main)
  const to = q.to ?? main
  const a = resolveVersion(view, from); const b = resolveVersion(view, to)
  const options = [
    ...branches.map((x) => ({ value: x, label: `branch ${x}` })),
    ...line.map((c, i) => ({ value: `v${line.length - i}`, label: `v${line.length - i}  ${c.message.slice(0, 40)}` })),
  ]
  const ensure = (v: string) => (options.some((o) => o.value === v) ? options : [{ value: v, label: v.slice(0, 12) }, ...options])
  return (
    <>
      <NamespaceHeader view={view} branch={branch} active="diff" />
      <form method="get" className="mb-4 flex flex-wrap items-center gap-2 text-[15px]">
        <label className="text-muted-foreground">from</label>
        <select name="from" defaultValue={from} className="rounded-md border border-border bg-card px-2 py-1.5 font-mono text-[13.5px]">{ensure(from).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        <label className="text-muted-foreground">to</label>
        <select name="to" defaultValue={to} className="rounded-md border border-border bg-card px-2 py-1.5 font-mono text-[13.5px]">{ensure(to).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        <button className="rounded-md bg-ink px-3 py-1.5 text-[15px] text-bg">compare</button>
      </form>
      {a && b ? (
        <Card className="p-4">
          <p className="mb-3 text-[13.5px] text-muted-foreground"><Mono>{a.id.slice(0, 7)}</Mono> “{a.message}” → <Mono>{b.id.slice(0, 7)}</Mono> “{b.message}”</p>
          <DiffView diff={diffSnapshots(a.snapshot, b.snapshot)} />
        </Card>
      ) : <Card className="p-4 text-[15px] text-muted-foreground">Could not resolve {!a ? from : to}. Use a branch, vN, HEAD, or a commit id.</Card>}
      <p className="mt-3 text-[13.5px] text-muted-foreground">A knowledge diff is by claim, not by line (PRD §13): what was believed before, what is believed now, and which fields — claim, confidence, sources — changed.</p>
    </>
  )
}
