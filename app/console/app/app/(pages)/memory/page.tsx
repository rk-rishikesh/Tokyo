import Link from 'next/link'
import { agentsOf, pendingOf } from '@k01/connect'
import { Repository } from '@k01/repo'
import type { Knowledge } from '@k01/core'
import { ownerOf, viewer } from '@/lib/session'
import { owned } from '../owned'
import { Block, Lock, SignInFirst, Title, Views, ago } from '../ui'
import { GraphView } from './graph'
import { Arrow } from '@/components/Arrow'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Memory' }

type View = 'list' | 'graph' | 'history'
type Stage = 'proposed' | 'local' | 'on chain' | 'shared' | 'superseded'

const STAGE_STYLE: Record<Stage, string> = {
  proposed: 'border border-dashed border-ink/40 text-ink/70',
  local: 'border border-line text-dim',
  'on chain': 'bg-raised text-ink',
  shared: 'bg-ink text-bg',
  superseded: 'text-dim line-through',
}

/**
 * Everything you know, in one place and three shapes.
 *
 * This used to be three tabs — Knowledge, Graph, History — each loading the
 * same namespaces and saying the same things in a different layout. It is one
 * page now, with the shape as a switch. The stage of each claim is read from
 * the chain (what your name actually points at), so "on chain" here means the
 * same thing it means on Publish.
 */
export default async function Memory({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const owner = ownerOf(await viewer())
  if (!owner) return <SignInFirst />
  const asked = (await searchParams).view
  const view: View = (['list', 'graph', 'history'] as const).find((v) => v === asked) ?? 'list'

  const [all, agents, pending] = await Promise.all([owned(owner), agentsOf(owner), pendingOf(owner).catch(() => [])])
  const chainCommit = new Map(pending.map((p) => [p.namespace, p.onChain?.commit ?? null]))
  const waiting = pending.reduce((n, p) => n + p.commits.length, 0)

  return (
    <>
      <Title eyebrow="memory" sub="Every claim your agent has written, under which name, and whether it has reached the chain yet.">
        Everything you know.
      </Title>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <Views
          current={view}
          views={[
            { id: 'list', label: 'List', href: '/app/memory' },
            { id: 'graph', label: 'Graph', href: '/app/memory?view=graph' },
            { id: 'history', label: 'History', href: '/app/memory?view=history' },
          ]}
        />
        <div className="mb-8 flex flex-wrap items-center gap-2">
          {/* Plain links: the browser downloads what the route marks as an attachment. */}
          <a href="/api/memory/export?format=json" className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-[14px] hover:bg-raised" download>
            <DownloadIcon /> JSON
          </a>
          <a href="/api/memory/export?format=md" className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-[14px] hover:bg-raised" download>
            <DownloadIcon /> Markdown
          </a>
        {waiting ? (
          <Link href="/app/publish" className="group inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-[14px] text-bg">
            {waiting} version{waiting === 1 ? '' : 's'} not on chain yet · Publish <Arrow />
          </Link>
        ) : null}
        </div>
      </div>

      {!all.length ? (
        <p className="rounded-3xl border border-dashed border-line px-6 py-10 text-center text-[14.5px] text-dim">
          Nothing yet. Connect a source on the Agent tab and let it learn something.
        </p>
      ) : view === 'graph' ? (
        <GraphView owner={owner} all={all} agents={agents} />
      ) : view === 'history' ? (
        <HistoryView all={all} chainCommit={chainCommit} />
      ) : (
        <ListView all={all} agents={agents.map((a) => a.namespaces.map((n) => n.namespace)).flat()} chainCommit={chainCommit} />
      )}
    </>
  )
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 1.5v6.5M3.2 5.5 6 8.3l2.8-2.8M2 10.5h8" />
    </svg>
  )
}

function ListView({ all, agents, chainCommit }: { all: Awaited<ReturnType<typeof owned>>; agents: string[]; chainCommit: Map<string, string | null> }) {
  const rows = all.map((o) => {
    const ns = o.access.namespace
    const readers = agents.filter((a) => a === ns).length
    const onChainId = chainCommit.get(ns)
    const onChainSnap = onChainId ? Repository.open(ns).store.getCommit(onChainId)?.snapshot ?? {} : {}
    const stageOf = (k: Knowledge): Stage => (onChainSnap[k.id] ? (readers ? 'shared' : 'on chain') : 'local')
    const items: { k: Knowledge; stage: Stage }[] = [
      ...o.proposed.map(({ claim }) => ({ k: claim, stage: 'proposed' as Stage })),
      ...Object.values(o.head?.snapshot ?? {}).map((k) => ({ k, stage: stageOf(k) })),
      ...o.superseded.map((k) => ({ k, stage: 'superseded' as Stage })),
    ]
    return { o, readers, items }
  })

  return (
    <>
      {rows.map(({ o, readers, items }) => (
        <Block
          key={o.access.namespace}
          title={o.access.namespace}
          note={`${items.filter((i) => i.stage !== 'superseded' && i.stage !== 'proposed').length} claims · v${o.access.version}`}
          aside={<Lock encrypted={o.access.encrypted} agents={readers} />}
        >
          <ul className="border-t border-line">
            {items.map(({ k, stage }) => (
              <li key={`${stage}${k.id}`} className="grid gap-2 border-b border-line py-4 sm:grid-cols-[1fr_auto] sm:items-baseline sm:gap-6">
                <div>
                  <p className={`text-[15px] tracking-[-0.015em] ${stage === 'superseded' ? 'text-dim line-through' : ''}`}>{k.claim}</p>
                  <p className="mt-1 font-mono text-[12.5px] text-dim">
                    {k.sources.map((s) => s.name ?? s.type).join(', ') || 'no source'} · {Math.round(k.confidence * 100)}%
                  </p>
                </div>
                <span className={`justify-self-start rounded-full px-2.5 py-1 text-[12.5px] sm:justify-self-end ${STAGE_STYLE[stage]}`}>{stage}</span>
              </li>
            ))}
          </ul>
        </Block>
      ))}
    </>
  )
}

function HistoryView({ all, chainCommit }: { all: Awaited<ReturnType<typeof owned>>; chainCommit: Map<string, string | null> }) {
  const rows = all.flatMap((o) => {
    const at = chainCommit.get(o.access.namespace)
    const idx = at ? o.line.findIndex((c) => c.id === at) : -1
    return o.line.map((c, i) => ({ ns: o.access.namespace, c, version: i + 1, onChain: idx >= i }))
  }).sort((a, b) => Date.parse(b.c.timestamp) - Date.parse(a.c.timestamp))

  return (
    <ol className="relative border-l border-line pl-6">
      {rows.slice(0, 300).map((r) => (
        <li key={`${r.ns}${r.c.id}`} className="relative pb-6">
          <span className={`absolute -left-[29px] top-1.5 h-2.5 w-2.5 rounded-full ${r.onChain ? 'bg-ink' : 'border border-ink/40 bg-bg'}`} />
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13.5px] text-dim">
            <span className="font-mono text-ink/80">{r.ns}</span>
            <span className="rounded-full bg-raised px-2 py-0.5 text-ink">v{r.version}</span>
            <span>{ago(r.c.timestamp)}</span>
            <span>{r.onChain ? 'on chain' : 'local only'}</span>
          </div>
          <p className="mt-1.5 text-[15px] tracking-[-0.015em]">{r.c.message}</p>
          <p className="mt-0.5 font-mono text-[12.5px] text-dim">
            {r.c.id.slice(0, 10)} · +{r.c.changes.added.length} ~{r.c.changes.updated.length} −{r.c.changes.removed.length}{r.c.proposal ? ' · via review' : ''}
          </p>
        </li>
      ))}
    </ol>
  )
}
