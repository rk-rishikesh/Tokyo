import Link from 'next/link'
import { Badge, Empty, PageHeader } from '@/components/ui'
import { defaultBranch, knownNamespaces, loadAll, openProposals, snapshotOf, tree, versionOf, type RepoView, type Tree } from '@/lib/repoview'

export const dynamic = 'force-dynamic'

/** Chevron for a node with children; turns when its own <details> is open. */
function Chevron() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform [details[open]>summary_&]:rotate-90" aria-hidden>
      <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

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

function Stats({ v }: { v: RepoView }) {
  const b = defaultBranch(v); const open = openProposals(v).length
  const claims = Object.keys(snapshotOf(v, b)).length
  const owner = v.refs.policy.owner
  return (
    <span className="ml-auto flex items-center gap-4 text-[13.5px] text-muted-foreground">
      {open ? <span className="text-ink">{open} to review</span> : null}
      {owner && owner !== v.namespace ? <span>owner {owner}</span> : null}
      <span className="tabular-nums">{claims} claim{claims === 1 ? '' : 's'}</span>
      <span className="w-8 text-right font-mono tabular-nums text-ink">v{versionOf(v, b)}</span>
    </span>
  )
}

/** A namespace with claims, or just a name that holds others. */
const hasClaims = (v: RepoView | null): v is RepoView => !!v && (v.source === 'ens' || Object.keys(snapshotOf(v, defaultBranch(v))).length > 0)

function ChildRow({ t, parent, depth }: { t: Tree; parent: string; depth: number }) {
  const line = (
    <div className="flex flex-wrap items-center gap-3 py-3 pr-5" style={{ paddingLeft: 20 + depth * 24 }}>
      {t.children.length ? <Chevron /> : <span className="w-4 shrink-0" aria-hidden />}
      {hasClaims(t.view) ? (
        <Link href={`/k/${encodeURIComponent(t.name)}`} className="flex flex-wrap items-center gap-3 hover:underline">
          <Name name={t.name} parent={parent} />
          {t.view.refs.title ? <span className="text-[14.5px] text-dim">{t.view.refs.title}</span> : null}
        </Link>
      ) : <Name name={t.name} parent={parent} />}
      {hasClaims(t.view) ? <><Tags v={t.view} /><Stats v={t.view} /></> : null}
    </div>
  )
  if (!t.children.length) return <li className="transition-colors hover:bg-raised/60">{line}</li>
  return (
    <li>
      <details open>
        <summary className="cursor-pointer list-none transition-colors hover:bg-raised/60 [&::-webkit-details-marker]:hidden">{line}</summary>
        <ul className="divide-y divide-line border-t border-line">{t.children.map((c) => <ChildRow key={c.name} t={c} parent={t.name} depth={depth + 1} />)}</ul>
      </details>
    </li>
  )
}

function Family({ t }: { t: Tree }) {
  const v = hasClaims(t.view) ? t.view : null
  const count = (x: Tree): number => x.children.reduce((n, c) => n + 1 + count(c), 0)
  const n = count(t)
  const header = (
    <div className="flex flex-wrap items-center gap-3 p-5">
      {t.children.length ? <Chevron /> : null}
      <Monogram name={t.name} />
      <div className="flex min-w-0 flex-col">
        {v ? (
          <Link href={`/k/${encodeURIComponent(t.name)}`} className="hover:underline"><Name name={t.name} size="root" /></Link>
        ) : <Name name={t.name} size="root" />}
        <span className="text-[13.5px] text-dim">
          {v?.refs.title ?? t.view?.refs.title ?? 'Name only — no claims of its own'}
          {n ? ` · ${n} namespace${n === 1 ? '' : 's'} under it` : ''}
        </span>
      </div>
      {v ? <><Tags v={v} /><Stats v={v} /></> : null}
    </div>
  )
  return (
    <section className="overflow-hidden rounded-[22px] border border-line bg-surface">
      {t.children.length ? (
        <details open>
          <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">{header}</summary>
          <ul className="divide-y divide-line border-t border-line">{t.children.map((c) => <ChildRow key={c.name} t={c} parent={t.name} depth={0} />)}</ul>
        </details>
      ) : header}
    </section>
  )
}

export default async function Namespaces() {
  const views = await loadAll()
  const roots = tree(views)
  const missing = knownNamespaces().filter((n) => !views.some((v) => v.namespace === n))
  return (
    <>
      <PageHeader title="Knowledge network" subtitle="Namespaces this explorer can read, as a hierarchy. Each is an ENS name whose contenthash points at a versioned, reviewed body of knowledge with its own owner, policy and sources." />
      {roots.length ? <div className="space-y-3">{roots.map((t) => <Family key={t.name} t={t} />)}</div>
        : <Empty>No namespaces. Set <code>NEXT_PUBLIC_KNOWLEDGE_NAMESPACES=cancer-research.eth</code> or run <code>knowledge init cancer-research.eth</code> on this machine.</Empty>}
      {missing.length ? <p className="mt-4 text-[13.5px] text-muted-foreground">Configured but unreadable here: {missing.join(', ')}</p> : null}
      <p className="mt-6 text-[13.5px] text-muted-foreground">Browse · search · resolve · inspect · compare versions · inspect sources · inspect contributors — open a namespace.</p>
    </>
  )
}
