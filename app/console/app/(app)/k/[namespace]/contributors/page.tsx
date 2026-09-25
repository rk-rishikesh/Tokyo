import { Badge, Card, Empty } from '@/components/ui'
import { contributorsOf } from '@/lib/repoview'
import { NamespaceHeader, load, type Params, type Query } from '../_shared'

export const dynamic = 'force-dynamic'

export default async function Contributors({ params, searchParams }: { params: Params; searchParams: Query }) {
  const { view, branch } = await load(params, searchParams)
  const rows = contributorsOf(view, branch)
  const pol = view.refs.policy
  const role = (n: string) => n.toLowerCase() === pol.owner.toLowerCase() ? 'owner' : pol.reviewers.some((r) => r.toLowerCase() === n.toLowerCase()) ? 'reviewer' : 'contributor'
  return (
    <>
      <NamespaceHeader view={view} branch={branch} active="contributors" />
      <Card className="mb-4 p-4 text-[15px]">
        <h2 className="mb-2 font-medium">Policy</h2>
        <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          <div><dt className="inline text-muted-foreground">Owner </dt><dd className="inline font-mono">{pol.owner}</dd></div>
          <div><dt className="inline text-muted-foreground">Reviewers </dt><dd className="inline font-mono">{pol.reviewers.join(', ') || '(owner only)'}</dd></div>
          <div><dt className="inline text-muted-foreground">Who may propose </dt><dd className="inline">{Array.isArray(pol.contributors) ? pol.contributors.join(', ') : 'anyone'}</dd></div>
          <div><dt className="inline text-muted-foreground">Approvals to land </dt><dd className="inline">{pol.approvals}</dd></div>
          <div><dt className="inline text-muted-foreground">Readers </dt><dd className="inline">{pol.readers === 'public' ? 'anyone (plaintext)' : 'key holders (encrypted)'}</dd></div>
        </dl>
        <p className="mt-2 text-[13.5px] text-muted-foreground">Roles are enforced by every repository acting on this namespace. Moving the published pointer is enforced by ENS: only the owner’s wallet holds SET_CONTENTHASH on the resolver.</p>
      </Card>
      {rows.length ? (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-left text-[15px]">
            <thead className="text-[13.5px] text-muted-foreground"><tr className="border-b border-border"><th className="px-4 py-2">Name</th><th className="px-4 py-2">Role</th><th className="px-4 py-2">Contributed</th><th className="px-4 py-2">Reviewed</th><th className="px-4 py-2">Commits</th><th className="px-4 py-2">Last active</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.name} className="border-b border-border last:border-0"><td className="px-4 py-2 font-mono">{r.name}</td><td className="px-4 py-2"><Badge tone={role(r.name) === 'owner' ? 'accent' : role(r.name) === 'reviewer' ? 'added' : 'neutral'}>{role(r.name)}</Badge></td><td className="px-4 py-2">{r.contributed}</td><td className="px-4 py-2">{r.reviewed}</td><td className="px-4 py-2">{r.commits}</td><td className="px-4 py-2 text-muted-foreground">{r.last.slice(0, 10) || '—'}</td></tr>)}</tbody>
          </table>
        </div>
      ) : <Empty>No contributions yet.</Empty>}
    </>
  )
}
