import Link from 'next/link'
import { redirect } from 'next/navigation'
import { findOwner } from '@knowledge01/core'
import { serverClient } from '@/lib/chain'
import { Badge, Empty, PageHeader } from '@/components/ui'
import { ExplorerShell } from '@/components/explorer/ExplorerShell'
import { defaultBranch, knownNamespaces, loadAll, loadRepo, openProposals, snapshotOf, versionOf, type RepoView } from '@/lib/repoview'

export const dynamic = 'force-dynamic'

function Lock() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
      <rect x="3" y="7" width="10" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

/** "treasury" in full weight, ".kestrel.eth" dimmed — the part that tells siblings apart leads. */
function Name({ name, parent, size = 'row' }: { name: string; parent?: string; size?: 'root' | 'row' }) {
  const own = parent && name.endsWith(`.${parent}`) ? name.slice(0, -(parent.length + 1)) : name.replace(/\.eth$/, '')
  const rest = name.slice(own.length)
  return (
    <span className={`font-mono ${size === 'root' ? 'text-[17px]' : 'text-[15px]'}`}>
      <span className="font-semibold text-ink">{own}</span>
      <span className="text-muted-foreground">{rest}</span>
    </span>
  )
}

/** A two-letter tile, so each family of names is recognisable at a glance. */
function Monogram({ name }: { name: string }) {
  const letters = name.replace(/\.eth$/, '').split(/[-.]/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')
  return <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink text-[14px] font-semibold text-bg" aria-hidden>{letters}</span>
}

function Tags({ v }: { v: RepoView }) {
  const kind = v.refs.policy.kind
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {v.refs.policy.readers === 'public'
        ? <Badge>Public</Badge>
        : <span className="inline-flex items-center gap-1 rounded-md bg-ink px-2 py-0.5 text-[12.5px] text-bg"><Lock />Private</span>}
      {kind && kind !== 'public' ? <Badge>{kind === 'organisation' ? 'Organisation' : 'Personal'}</Badge> : null}
      {v.source === 'ens' ? null : <Badge tone="warn">local only</Badge>}
    </span>
  )
}

/** A namespace with claims, not just a name that holds others. */
const hasClaims = (v: RepoView | null): v is RepoView => !!v && (v.source === 'ens' || Object.keys(snapshotOf(v, defaultBranch(v))).length > 0)

/** A namespace this explorer can open, as one card of the overview. */
function Card({ v }: { v: RepoView }) {
  const b = defaultBranch(v)
  const claims = Object.keys(snapshotOf(v, b)).length
  const open = openProposals(v).length
  const parent = v.refs.parent ?? (v.namespace.split('.').length > 2 ? v.namespace.split('.').slice(1).join('.') : undefined)
  return (
    <Link href={`/k/${encodeURIComponent(v.namespace)}`} className="group flex flex-col gap-3 rounded-[18px] border border-line bg-surface p-5 transition-colors hover:border-ink/25">
      <div className="flex items-start gap-3">
        <Monogram name={parent ?? v.namespace} />
        <div className="min-w-0">
          <p className="truncate group-hover:underline"><Name name={v.namespace} parent={parent} /></p>
          <p className="truncate text-[13.5px] text-dim">{v.refs.title ?? (parent ? `under ${parent}` : 'Untitled')}</p>
        </div>
        <span className="ml-auto font-mono text-[13px] tabular-nums text-ink">v{versionOf(v, b)}</span>
      </div>
      {v.refs.description ? <p className="line-clamp-2 text-[13.5px] leading-relaxed text-dim">{v.refs.description}</p> : null}
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] text-dim">
        <Tags v={v} />
        <span className="tabular-nums">{claims} claim{claims === 1 ? '' : 's'}</span>
        {open ? <span className="text-ink">{open} to review</span> : null}
      </div>
    </Link>
  )
}

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
  const missing = knownNamespaces().filter((n) => !views.some((v) => v.namespace === n))
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
          ['Encrypted', sealed + missing.length],
          ['Open reviews', views.reduce((n, v) => n + openProposals(v).length, 0)],
        ].map(([label, n]) => (
          <div key={label} className="bg-surface px-5 py-4">
            <dt className="text-[12px] uppercase tracking-[0.08em] text-dim">{label}</dt>
            <dd className="mt-1 font-display text-[2rem] leading-none tabular-nums">{n}</dd>
          </div>
        ))}
      </dl>

      <section className="mt-10">
        <h2 className="mb-4 font-display text-[1.6rem] font-normal leading-tight">Readable here</h2>
        {views.length ? (
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">{views.map((v) => <Card key={v.namespace} v={v} />)}</div>
        ) : <Empty>No namespace is readable from this deployment yet.</Empty>}
        {missing.length ? (
          <p className="mt-5 text-[13.5px] text-dim">Also on the network, encrypted: {missing.map((n, i) => <span key={n}>{i ? ', ' : ''}<span className="font-mono text-ink/75">{n}</span></span>)}.</p>
        ) : null}
      </section>
    </ExplorerShell>
  )
}
