import { Empty } from '@/components/ui'
import { CommitRow } from '@/components/CommitRow'
import { headOf, logOf, proposalsOf, defaultBranch } from '@/lib/repoview'
import { BranchPicker, NamespaceHeader, load, type Params, type Query } from '../_shared'

export const dynamic = 'force-dynamic'

export default async function History({ params, searchParams }: { params: Params; searchParams: Query }) {
  const { view, branch } = await load(params, searchParams)
  const commits = logOf(view, branch, 500)
  const head = headOf(view, branch)
  const isMain = branch === defaultBranch(view)
  const byCommit = new Map(proposalsOf(view).filter((p) => p.mergedCommit).map((p) => [p.mergedCommit!, p.number]))
  return (
    <>
      <NamespaceHeader view={view} branch={branch} active="history" />
      <BranchPicker view={view} branch={branch} path="/history" />
      {commits.length ? (
        <ul className="rounded-lg border border-border bg-card px-4">
          {commits.map((c, i) => <CommitRow key={c.id} c={c} namespace={view.namespace} isHead={c.id === head?.id} version={isMain ? commits.length - i : undefined} proposalNumber={byCommit.get(c.id)} cid={view.refs.objects[c.id]} gatewayUrl={view.refs.objects[c.id] ? view.gatewayUrl(view.refs.objects[c.id]!) : null} />)}
        </ul>
      ) : <Empty>No versions on {branch} yet.</Empty>}
      <p className="mt-3 text-[13.5px] text-muted-foreground">Every version is a commit whose id is the hash of its content. Click one to see exactly what it changed; “via review” links to the proposal that landed it.</p>
    </>
  )
}
