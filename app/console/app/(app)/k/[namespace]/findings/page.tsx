import Link from 'next/link'
import { Card, Empty } from '@/components/ui'
import { Arrow } from '@/components/Arrow'
import { ownerOf, viewer } from '@/lib/session'
import { NamespaceHeader, load, type Params } from '../_shared'

export const dynamic = 'force-dynamic'

/** What each finding is asking, in words anyone already uses. */
const PLAIN: Record<string, string> = {
  contradiction: 'Might disagree',
  supersession: 'Replaces an older claim',
  duplicate: 'Looks like a repeat',
  'missing-sources': 'No source',
  'low-confidence': 'Little evidence',
  'unsupported-change': 'Changed without a source',
  removal: 'Removed',
}

/**
 * Things to check: what automated review noticed on changes that went in
 * without a review first.
 *
 * Shown as the claims themselves, not as commit hashes and a CLI command. The
 * owner answers them in one click on Publish; everyone else sees what is
 * being checked.
 */
export default async function Findings({ params }: { params: Params }) {
  const { view, branch } = await load(params)
  const base = `/k/${encodeURIComponent(view.namespace)}`
  const owner = ownerOf(await viewer())
  const mine = !!owner && (view.namespace === owner || view.namespace.endsWith(`.${owner}`))

  const rows = Object.entries(view.refs.findings ?? {})
    .map(([id, fs]) => ({ commit: view.commits[id], findings: fs }))
    .filter((r) => r.commit)
    .sort((a, b) => b.commit!.timestamp.localeCompare(a.commit!.timestamp))
  const count = rows.reduce((n, r) => n + r.findings.length, 0)

  return (
    <>
      <NamespaceHeader view={view} branch={branch} active="findings" />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <p className="max-w-2xl text-[15px] text-muted-foreground">
          {count ? `${count} thing${count === 1 ? '' : 's'} to check. Nothing was lost — these went in, and are waiting for a yes or no.` : 'Nothing to check.'}
        </p>
        {mine && count ? (
          <Link href="/app/publish" className="group inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-[14px] text-bg">
            Decide on Publish <Arrow />
          </Link>
        ) : null}
      </div>
      {rows.length ? (
        <div className="space-y-3">
          {rows.flatMap(({ commit, findings }) => findings.map((f, i) => {
            const k = commit!.snapshot[f.id]
            const other = f.related ? commit!.snapshot[f.related] : undefined
            return (
              <Card key={`${commit!.id}-${i}`} className="p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="rounded-full bg-raised px-2.5 py-1 text-[13px]">{PLAIN[f.kind] ?? f.kind}</span>
                  <span className="text-[13px] text-muted-foreground">{commit!.timestamp.slice(0, 10)}</span>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-[12.5px] text-muted-foreground">{other ? 'New' : 'Claim'}</p>
                    <p className="mt-1 text-[16px] tracking-[-0.015em]">{k?.claim ?? '(no longer here)'}</p>
                  </div>
                  {other ? (
                    <div>
                      <p className="text-[12.5px] text-muted-foreground">Already there</p>
                      <Link href={`${base}/item/${encodeURIComponent(other.id)}`} className="mt-1 block text-[16px] tracking-[-0.015em] underline-offset-4 hover:underline">{other.claim}</Link>
                    </div>
                  ) : null}
                </div>
              </Card>
            )
          }))}
        </div>
      ) : <Empty>Nothing to check.</Empty>}
    </>
  )
}
