import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge, Card } from '@/components/ui'
import { defaultBranch, loadRepo, logOf, snapshotOf } from '@/lib/repoview'
import { humanTopic, humanType, narrate, timeAgo, writers } from '@/lib/narrate'
import { Arrow } from '@/components/Arrow'

export const dynamic = 'force-dynamic'

/**
 * The owner's view. No commit ids, no CIDs, no branches — sentences.
 * Every link to "the details" goes to the developer explorer for the same thing.
 */
export default async function Me({ params, searchParams }: { params: Promise<{ namespace: string }>; searchParams: Promise<{ topic?: string }> }) {
  const { namespace: raw } = await params
  const { topic } = await searchParams
  const namespace = decodeURIComponent(raw)
  const view = await loadRepo(namespace)
  if (!view) notFound()
  const branch = defaultBranch(view)
  const all = Object.values(snapshotOf(view, branch))
  const groups = new Map<string, typeof all>()
  for (const m of all) { const k = m.topic ?? ''; groups.set(k, [...(groups.get(k) ?? []), m]) }
  const topics = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)
  const shown = topic !== undefined ? (groups.get(topic) ?? []) : all
  const events = narrate(view, logOf(view, branch, 40)).slice(0, 12)
  const apps = writers(view)
  const dev = `/k/${encodeURIComponent(namespace)}`
  const me = `/me/${encodeURIComponent(namespace)}`

  return (
    <>
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[13.5px] text-muted-foreground">Personal namespace</p>
          <h1 className="mt-1 text-3xl font-display font-normal tracking-tight">{view.identity}</h1>
          <p className="mt-2 text-[15px] text-muted-foreground">
            <span className="font-semibold text-foreground">{all.length}</span> memories · <span className="font-semibold text-foreground">{apps.length}</span> connected {apps.length === 1 ? 'app' : 'apps'} ·{' '}
            {view.source === 'ens' ? <span>published at <span className="font-mono">{namespace}</span></span> : <span>on this device only</span>}
          </p>
        </div>
        <Link href={dev} className="text-[13.5px] text-muted-foreground hover:text-foreground">full explorer <Arrow /></Link>
      </header>

      {/* Topics */}
      <div className="mb-8 flex flex-wrap gap-2">
        <Link href={me} className={`rounded-xl border px-4 py-3 ${topic === undefined ? 'border-accent bg-accent/10' : 'border-border bg-card hover:border-accent/50'}`}>
          <p className="text-[13.5px] text-muted-foreground">Everything</p><p className="font-mono text-lg font-semibold">{all.length}</p>
        </Link>
        {topics.map(([k, ms]) => (
          <Link key={k} href={`${me}?topic=${encodeURIComponent(k)}`} className={`rounded-xl border px-4 py-3 ${topic === k ? 'border-accent bg-accent/10' : 'border-border bg-card hover:border-accent/50'}`}>
            <p className="text-[13.5px] text-muted-foreground">{humanTopic(k || null)}</p><p className="font-mono text-lg font-semibold">{ms.length}</p>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="mb-3 text-[15px] font-medium">{topic !== undefined ? humanTopic(topic || null) : 'What your AI remembers'}</h2>
            {shown.length ? (
              <ul className="divide-y divide-border">
                {shown.sort((a, b) => (b.updated_at ?? b.created_at).localeCompare(a.updated_at ?? a.created_at)).map((m) => (
                  <li key={m.id} className="py-3">
                    <p className="text-[15px] leading-relaxed">{m.claim}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[13.5px] text-muted-foreground">
                      <span>{humanType(m.type)}</span>·<span>{humanTopic(m.topic)}</span>·<span>added by <span className="text-foreground">{m.contributor}</span></span>·<span>{timeAgo(m.updated_at ?? m.created_at)}</span>
                      {m.confidence < 0.7 ? <Badge tone="warn">one observation</Badge> : m.confidence < 0.8 ? <Badge tone="neutral">inferred</Badge> : null}
                      <Link href={`${dev}/item/${encodeURIComponent(m.id)}?branch=${branch}`} className="ml-auto text-accent hover:underline">why does it think this?</Link>
                    </p>
                  </li>
                ))}
              </ul>
            ) : <p className="text-[15px] text-muted-foreground">Nothing here yet.</p>}
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="mb-3 text-[15px] font-medium">Connected apps</h2>
            <ul className="space-y-2">
              {apps.map((a) => (
                <li key={a.agent} className="flex items-center gap-3 text-[15px]">
                  <span className="h-2 w-2 rounded-full bg-added" />
                  <span className="font-medium">{a.agent}</span>
                  <span className="ml-auto text-[13.5px] text-muted-foreground">{a.memories} memories · last {timeAgo(a.last)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[13.5px] text-muted-foreground">Apps that have written to your memory. Access today is the key; per-app limits are not built yet.</p>
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 text-[15px] font-medium">Recent changes</h2>
            <ul className="space-y-3">
              {events.map((e, i) => (
                <li key={i} className="text-[15px]">
                  <p className="font-medium">{e.headline}</p>
                  {e.kind === 'changed' && e.before && e.after && e.before.claim !== e.after.claim ? (
                    <p className="mt-0.5 text-[14.5px] text-muted-foreground">Previously <span className="line-through">{e.before.claim}</span>. Now <span className="text-foreground">{e.after.claim}</span>.</p>
                  ) : e.after ? <p className="mt-0.5 text-[14.5px] text-muted-foreground">{e.after.claim}</p>
                    : e.before ? <p className="mt-0.5 text-[14.5px] text-muted-foreground line-through">{e.before.claim}</p> : null}
                  <p className="mt-0.5 text-[13.5px] text-muted-foreground">{e.by} · {timeAgo(e.at)} · <Link href={`${dev}/history?branch=${branch}`} className="text-accent hover:underline">details</Link></p>
                </li>
              ))}
              {!events.length ? <li className="text-[15px] text-muted-foreground">No changes yet.</li> : null}
            </ul>
          </Card>

          <Card className="p-5 text-[15px]">
            <h2 className="mb-2 text-[15px] font-medium">Correct or forget something</h2>
            <p className="text-[14.5px] text-muted-foreground">Tell a connected assistant “that’s wrong” or “forget that”, and it records the correction. Or use the command line — see <Link href="/roles/owner" className="text-accent hover:underline">how to use it</Link>.</p>
          </Card>
        </div>
      </div>
    </>
  )
}
