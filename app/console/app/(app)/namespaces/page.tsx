import Link from 'next/link'
import { redirect } from 'next/navigation'
import { findOwner } from '@knowledge01/core'
import { serverClient } from '@/lib/chain'
import { PageHeader } from '@/components/ui'
import { ExplorerShell } from '@/components/explorer/ExplorerShell'
import { defaultBranch, loadAll, loadRepo, openProposals, snapshotOf, type RepoView } from '@/lib/repoview'

/** A namespace with claims, not just a name that holds others. */
const hasClaims = (v: RepoView | null): v is RepoView => !!v && (v.source === 'ens' || Object.keys(snapshotOf(v, defaultBranch(v))).length > 0)

export const dynamic = 'force-dynamic'

/**
 * Look a name up on ENS. A readable namespace goes straight to its page; any
 * other outcome is explained here, because "not found" hides the difference
 * between a free name, an empty one and an encrypted one.
 */
async function lookup(raw: string): Promise<{ name: string; message: string } | null> {
  const name = raw.trim().toLowerCase().replace(/^https?:\/\/[^/]+\/k\//, '')
  if (!name) return null
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.eth$/.test(name)) return { name, message: 'That is not an ENS name — try something like cancer-research.eth.' }
  let readable = false
  try { readable = !!(await loadRepo(name)) }
  catch (e) {
    return { name, message: /decrypt|content key|private/i.test(e instanceof Error ? e.message : '') ? 'This namespace is encrypted, and this explorer does not hold its key. Only agents it was granted to can read it.' : 'This name could not be read right now. Try again in a moment.' }
  }
  if (readable) redirect(`/k/${encodeURIComponent(name)}`)
  const owner = await findOwner(serverClient(), name).catch(() => null)
  return owner && BigInt(owner) !== 0n
    ? { name, message: `Registered on Sepolia to ${owner.slice(0, 6)}…${owner.slice(-4)}, but no knowledge has been published under it yet.` }
    : { name, message: 'This name is not registered on Sepolia, so there is no memory under it.' }
}

export default async function Namespaces({ searchParams }: { searchParams: Promise<{ name?: string }> }) {
  const { name: query = '' } = await searchParams
  const result = await lookup(query)
  const views = (await loadAll()).filter(hasClaims)
  const claims = views.reduce((n, v) => n + Object.keys(snapshotOf(v, defaultBranch(v))).length, 0)
  const sealed = views.filter((v) => v.refs.policy.readers === 'key').length
  return (
    <ExplorerShell>
      <PageHeader title="Knowledge network" subtitle="Every namespace is an ENS name whose contenthash points at a versioned, reviewed body of knowledge with its own owner, policy and sources. Pick one on the left, or look any name up." />
      <form action="/namespaces" method="get" role="search" className="rounded-2xl border border-line bg-surface p-3 shadow-[0_18px_40px_-32px_hsl(var(--ink)/0.35)] focus-within:border-ink/30">
        <input name="name" defaultValue={query} placeholder="Look up any ENS name — e.g. treasury.eth" aria-label="ENS name" autoComplete="off" spellCheck={false} className="w-full bg-transparent px-2 pb-6 pt-2 font-mono text-[16px] outline-none placeholder:text-dim" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {views.slice(0, 4).map((v) => <Link key={v.namespace} href={`/k/${encodeURIComponent(v.namespace)}`} className="rounded-full bg-raised px-3 py-1 font-mono text-[12.5px] text-ink/75 transition-colors hover:text-ink">{v.namespace}</Link>)}
          </div>
          <button className="ml-auto rounded-xl bg-ink px-5 py-2 text-[14px] text-bg transition-opacity hover:opacity-85">Look up</button>
        </div>
      </form>
      {result ? (
        <div className="mt-3 rounded-xl border border-line bg-raised/50 px-4 py-3 text-[14px]">
          <span className="font-mono font-semibold">{result.name}</span> <span className="text-dim">— {result.message}</span>
        </div>
      ) : null}

      <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-4">
        {[
          ['Namespaces', views.length],
          ['Claims', claims],
          ['Encrypted', sealed],
          ['Open reviews', views.reduce((n, v) => n + openProposals(v).length, 0)],
        ].map(([label, n]) => (
          <div key={label} className="bg-surface px-5 py-4">
            <dt className="text-[12px] uppercase tracking-[0.08em] text-dim">{label}</dt>
            <dd className="mt-1 font-display text-[2rem] leading-none tabular-nums">{n}</dd>
          </div>
        ))}
      </dl>

    </ExplorerShell>
  )
}
