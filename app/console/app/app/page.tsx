import { brokenConnections, llmConfig, progress, readActivity, readGrants, workspacesFor, type ActivityEntry } from '@k01/connect'
import { ownerOf, viewer } from '@/lib/session'
import { SignIn } from './SignIn'
import { Canvas, type Stage } from './Canvas'
import { Feed } from './Feed'
import { PromptBar } from './PromptBar'
import { Sidebar, type SidebarSource } from './Sidebar'
import { TopBar } from './TopBar'
import { defaultBranch, loadRepo, snapshotOf, type RepoView } from '@/lib/repoview'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Your agent — connected sources' }

const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`
}

/**
 * The demo product, as a workspace rather than a page.
 *
 * Sources down the left, the pipeline they feed in the middle, chat docked at
 * the bottom and what the agent saw on the right. It was a column of stacked
 * cards at `max-w-6xl`, which made the thing being built look like
 * documentation about itself.
 *
 * The watcher only learns. Chat, in the bar below, can act on connected apps —
 * and stops for approval before it does. Keeping those apart is the argument:
 * an agent that watches everything is tolerable because it cannot act on what
 * it sees, and one that acts is tolerable because you asked it to.
 */
export default async function AgentApp() {
  const v = await viewer()
  const owner = ownerOf(v)
  const userId = v.mode === 'hosted' ? v.user?.id : undefined
  const hosted = v.mode === 'hosted'

  // Only sources this person can genuinely connect. On a hosted site the local
  // readers would read the *server's* files, so they are not offered at all.
  const sources = workspacesFor({ hosted, ...(hosted ? { providers: v.providers } : {}) })

  if (hosted && !v.user) return <SignIn providers={v.providers} sources={sources} />

  const connectedProviders = new Set(hosted ? (v.user?.tokens ?? []).map((t) => t.provider) : [])
  const broken = new Map(userId ? brokenConnections(userId).map((b) => [b.provider as string, b.detail]) : [])

  const prog = progress(userId)
  const activity: ActivityEntry[] = readActivity(60, userId)
  const lastWrite = activity.find((a) => a.outcome.status === 'committed')?.at

  // What the agent has built, read from the namespaces themselves rather than
  // counted from the activity log — the log records attempts, the namespaces
  // are the truth.
  const namespaces = [...new Set(activity.flatMap((a) => (a.outcome.status === 'committed' ? [a.outcome.namespace] : [])))]
  const views = (await Promise.all(namespaces.map((n) => loadRepo(n).catch(() => null)))).filter((x): x is RepoView => !!x)
  const claims = views.flatMap((view) => Object.values(snapshotOf(view, defaultBranch(view))).map((k) => ({ k, ns: view.namespace })))
  const skipped = activity.filter((a) => a.outcome.status === 'skipped')
  const cited = new Set(claims.flatMap(({ k }) => k.sources.map((s) => s.name ?? s.type)))

  const claimsBySource = new Map<string, number>()
  for (const { k } of claims) {
    for (const s of k.sources) {
      const key = (s.name ?? s.type).toLowerCase()
      claimsBySource.set(key, (claimsBySource.get(key) ?? 0) + 1)
    }
  }

  const sidebar: SidebarSource[] = sources.map((ws) => {
    const p = prog.find((x) => x.workspaceId === ws.id)
    const failing = ws.provider ? broken.get(ws.provider) : undefined
    return {
      ws,
      connected: !!p?.connected,
      needsAuth: hosted && ws.access === 'oauth' && !connectedProviders.has(ws.provider!),
      ...(failing ? { failing } : {}),
      claims: claimsBySource.get(ws.name.toLowerCase()) ?? 0,
    }
  })

  const connectedCount = sidebar.filter((s) => s.connected).length
  const stages: Stage[] = [
    {
      id: 'sources',
      label: 'Connected sources',
      glyph: '🔌',
      detail: connectedCount ? 'reading on a timer' : 'connect one to begin',
      count: connectedCount || null,
      tone: connectedCount ? 'accent' : 'dim',
    },
    {
      id: 'observed',
      label: 'Observed',
      glyph: '👁',
      detail: 'things the agent saw',
      count: activity.length || null,
      tone: activity.length ? 'plain' : 'dim',
    },
    {
      id: 'judged',
      label: 'Left out',
      glyph: '⌀',
      detail: 'not knowledge, and why',
      count: skipped.length || null,
      href: '/why',
      tone: 'dim',
    },
    {
      id: 'claims',
      label: 'Remembered',
      glyph: '◈',
      detail: `claims across ${views.length} namespace${views.length === 1 ? '' : 's'}`,
      count: claims.length || null,
      ...(views[0] ? { href: `/k/${encodeURIComponent(views[0].namespace)}` } : {}),
      tone: claims.length ? 'accent' : 'dim',
    },
    {
      id: 'cited',
      label: 'Sources cited',
      glyph: '※',
      detail: 'every claim names one',
      count: cited.size || null,
      tone: 'plain',
    },
  ]

  return (
    <div className="flex h-[calc(100vh-57px)] w-full overflow-hidden">
      <Sidebar sources={sidebar} owner={owner!} />

      <div className="relative flex min-w-0 flex-1 flex-col">
        <TopBar
          namespace={owner!}
          {...(hosted && v.user?.wallet ? { address: v.user.wallet.address } : {})}
          {...(lastWrite ? { lastWrite: ago(lastWrite) } : {})}
          model={llmConfig()?.model ?? null}
        />

        <div className="min-h-0 flex-1"><Canvas stages={stages} namespace={owner!} /></div>

        {owner ? <PromptBar namespace={owner} /> : null}
      </div>

      {/* What it saw, kept to the side so the canvas stays the subject. */}
      <aside className="hidden h-full w-[340px] shrink-0 flex-col border-l border-line bg-surface xl:flex">
        <div className="flex items-baseline justify-between px-4 pb-3 pt-4">
          <h2 className="text-[14px] font-semibold">What it saw</h2>
          <span className="text-[12.5px] text-dim">{activity.length ? `${activity.length} recent` : ''}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          <Feed activity={activity} ago={ago} />
        </div>
      </aside>
    </div>
  )
}
