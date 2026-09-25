/**
 * GitHub — what you actually build, from the account you already have.
 *
 * No API key to obtain: if `gh auth login` has been run, the token is already on
 * this machine and the CLI will lend it. A fine-grained PAT in GITHUB_TOKEN works
 * too. Nothing here creates an OAuth app, because a Connect button that needs one
 * is a button most people cannot press.
 *
 * The rule the other readers follow applies here as well: state the pattern, not
 * the log. "Works on loops-platform, a TypeScript project" is a durable fact a
 * second party would want the source of. "Pushed 3 commits at 14:03 on Tuesday"
 * is a log, and a namespace full of logs is surveillance with a version history.
 */
import { execFileSync } from 'node:child_process'
import type { Finding } from './local-sources.js'
import { POLICY, periodPhrase } from './policy.js'

export type Repo = { name: string; owner: string; language: string | null; events: number; description: string | null; private: boolean }

/**
 * The token, from the environment or from `gh`.
 *
 * `gh auth token` is preferred over reading its config: it is the supported
 * interface, and it handles the keyring on machines where the token is not in a
 * file at all — which is the case on macOS by default.
 */
export function githubToken(env: NodeJS.ProcessEnv = process.env): string | null {
  const fromEnv = env.GITHUB_TOKEN?.trim() || env.GH_TOKEN?.trim()
  if (fromEnv) return fromEnv
  try {
    const t = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim()
    return t || null
  } catch { return null }
}

/** Whether this source can read anything at all, without asking the person for a key. */
export function githubAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!githubToken(env)
}

async function api<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`https://api.github.com/${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'knowledge-connect' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`github ${path}: ${res.status} ${await res.text().catch(() => '')}`.slice(0, 200))
  return res.json() as Promise<T>
}

type GhEvent = { type: string; repo: { name: string }; created_at: string }
type GhRepo = { name: string; owner: { login: string }; language: string | null; description: string | null; private: boolean; fork: boolean }

/**
 * Repositories you have actually worked in recently, most active first.
 *
 * The window is short on purpose. Each pass asks a narrow question — what have
 * you worked on lately — and the answer is kept forever, because claims are
 * never removed once written. Memory grows from many small reads rather than
 * one large one, which is what makes a repo you have since moved on from stay
 * in your namespace with the evidence from when it was true.
 *
 * A long window would work against that. It re-states old facts on every pass,
 * and it drowns this week's work in three months of it.
 *
 * GitHub also caps its events API at 300 entries across 3 pages, so a long
 * window is partly fiction anyway: on a busy account 300 events is a few weeks.
 * Evidence records the period actually observed, which may be shorter than the
 * window asked for, and never longer.
 *
 * Events that represent work (pushes, PRs, branches, releases, reviews) are
 * counted; stars and watches are not, because reading is not building.
 */
export async function activeRepos(
  token: string,
  opts: { login?: string; days?: number } = {},
): Promise<{ repos: Repo[]; observedDays: number; events: number }> {
  const login = opts.login ?? (await api<{ login: string }>('user', token)).login
  const days = opts.days ?? POLICY.github.windowDays
  const since = Date.now() - days * 86_400_000

  // Three pages is GitHub's hard limit; asking for a fourth returns 422. Stop
  // early once events fall outside the window, so a quiet account does not pay
  // for pages it will discard.
  const events: GhEvent[] = []
  for (let page = 1; page <= 3; page++) {
    let batch: GhEvent[]
    try {
      batch = await api<GhEvent[]>(`users/${login}/events?per_page=100&page=${page}`, token)
    } catch {
      break
    }
    events.push(...batch)
    if (batch.length < 100) break
    if (batch.some((e) => Date.parse(e.created_at) < since)) break
  }

  const WORK = new Set(['PushEvent', 'PullRequestEvent', 'CreateEvent', 'IssuesEvent', 'ReleaseEvent', 'PullRequestReviewEvent'])
  const counts = new Map<string, number>()
  let reach = Date.now()
  for (const e of events) {
    const at = Date.parse(e.created_at)
    // How far back the data goes, including events outside the window: this is
    // what decides whether the whole window was actually covered.
    if (at < reach) reach = at
    if (at < since) continue
    if (!WORK.has(e.type)) continue
    counts.set(e.repo.name, (counts.get(e.repo.name) ?? 0) + 1)
  }
  // The period observed is the window, unless GitHub's cap cut the data short
  // first. Reporting the age of the oldest *matching* event instead would say
  // "3 days" for someone who committed once on Tuesday and not before — which
  // understates the evidence, since the quiet days were looked at too.
  const reachedDays = Math.max(1, Math.round((Date.now() - reach) / 86_400_000))
  const observedDays = Math.min(days, reachedDays)

  const out: Repo[] = []
  for (const [full, events_] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, POLICY.github.keep)) {
    try {
      const r = await api<GhRepo>(`repos/${full}`, token)
      // A fork you pushed a single commit to is a drive-by fix, not a project.
      // Two is the bar here rather than five: in a 15-day window, five events
      // in a fork would be unusual even for someone genuinely working on it.
      if (r.fork && events_ < POLICY.github.minForFork) continue
      out.push({ name: r.name, owner: r.owner.login, language: r.language, description: r.description, events: events_, private: r.private })
    } catch { /* a repo that vanished or turned private should not stop the pass */ }
  }
  return { repos: out, observedDays, events: events.length }
}

/**
 * Claims from repository activity.
 *
 * A private repository contributes its language and nothing else — the name and
 * description are the parts someone chose not to publish, and a namespace that
 * leaks them is worse than one that stays quiet. The bar is deliberately higher
 * than one commit: a repo touched twice in three months is noise.
 */
export function findings(input: Repo[] | { repos: Repo[]; observedDays: number }): Finding[] {
  const { repos, observedDays } = Array.isArray(input) ? { repos: input, observedDays: 0 } : input
  // Say the window that was actually observed. "in 90 days" on data that only
  // reached back three weeks is a claim the evidence does not support, and
  // provenance that overstates itself is worse than provenance that is vague.
  const period = periodPhrase(observedDays)
  const out: Finding[] = []
  const langs = new Map<string, number>()

  // Two repositories can share a name — an upstream and your fork of it are the
  // common case. Naming only the repo would produce two claims that read as
  // duplicates, so an ambiguous name is qualified by its owner.
  const shared = new Set(
    repos.map((r) => r.name).filter((n, i, all) => all.indexOf(n) !== i),
  )

  for (const r of repos) {
    if (r.language) langs.set(r.language, (langs.get(r.language) ?? 0) + r.events)
    // One contribution in the window is enough. The window is already short, so
    // anything inside it is recent by construction, and a repo you pushed to
    // last week is a repo you work on — the count is on the claim for anyone
    // who wants to weigh it.
    if (r.events < POLICY.github.min) continue
    if (r.private) continue
    const what = r.language ? `, a ${r.language} project` : ''
    const name = shared.has(r.name) ? `${r.owner}/${r.name}` : r.name
    out.push({
      text: `Works on ${name}${what}`,
      topic: 'projects',
      evidence: `${r.events} contribution${r.events === 1 ? '' : 's'}${period}`,
      ref: `https://github.com/${r.owner}/${r.name}`,
      // A single contribution in the window is worth claiming and not worth
      // being as sure about as fifteen.
      ...(r.events < 3 ? { weak: true } : {}),
    })
  }

  // One language claim, for the language the work is actually in — not a list of
  // every language any repo happens to contain.
  const top = [...langs].sort((a, b) => b[1] - a[1])[0]
  if (top && top[1] >= POLICY.github.minForLanguage) {
    const n = repos.filter((r) => r.language === top[0]).length
    out.push({ text: `Writes ${top[0]}`, topic: 'tools', evidence: `${top[1]} contribution${top[1] === 1 ? '' : 's'}${period} across ${n} repositor${n === 1 ? 'y' : 'ies'}`, ref: 'https://github.com' })
  }
  return out
}
