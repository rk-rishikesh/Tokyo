/**
 * Chrome history — the first integration that connects to something real.
 *
 * No OAuth, no webhook, no vendor app: Chrome keeps history in a local SQLite
 * file that belongs to you. That makes it the honest first connector — the data
 * is genuinely yours, on your machine, and nothing is mocked.
 *
 * The hard part is not reading it; it is deciding what in there is *knowledge*.
 * A page visit is not a claim: visiting a mail inbox 295 times says nothing that
 * is true or false about the world. What is durable is the pattern underneath —
 * the projects you work on, the tools you use, the domains you rely on. So this
 * reads the history and states those, with the visit counts as the evidence.
 *
 * What it never does: log browsing. No per-visit claims, no timestamps of what
 * you read, nothing about pages visited once. A namespace of "you looked at X on
 * Tuesday" would be surveillance with a version history, which is the opposite
 * of the point.
 */
import { execFileSync } from 'node:child_process'
import { POLICY } from './policy.js'
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ConnectorEvent } from './routing.js'

export type ChromeProfile = { name: string; path: string }

/** Where Chrome keeps history, per platform. Firefox and Edge use the same shape. */
export function chromeProfiles(): ChromeProfile[] {
  const home = homedir()
  const roots = [
    { label: 'Chrome', dir: join(home, 'Library/Application Support/Google/Chrome') },
    { label: 'Chrome', dir: join(home, '.config/google-chrome') },
    { label: 'Chrome', dir: join(home, 'AppData/Local/Google/Chrome/User Data') },
    { label: 'Brave', dir: join(home, 'Library/Application Support/BraveSoftware/Brave-Browser') },
    { label: 'Edge', dir: join(home, 'Library/Application Support/Microsoft Edge') },
  ]
  const out: ChromeProfile[] = []
  for (const r of roots) {
    for (const p of ['Default', 'Profile 1', 'Profile 2']) {
      const f = join(r.dir, p, 'History')
      if (existsSync(f)) out.push({ name: `${r.label} · ${p}`, path: f })
    }
  }
  return out
}

export type SiteRow = { host: string; title: string; visits: number; urls: number }

/**
 * Read per-host totals from a history database.
 *
 * Chrome holds the file open, so it is copied first — reading the live file
 * fails with "database is locked" while the browser runs.
 */
export function readHistory(dbPath: string, opts: { days?: number } = {}): SiteRow[] {
  if (!existsSync(dbPath)) throw new Error(`no history at ${dbPath}`)
  const tmp = mkdtempSync(join(tmpdir(), 'chrome-history-'))
  const copy = join(tmp, 'History')
  try {
    copyFileSync(dbPath, copy)
    // Chrome timestamps are microseconds since 1601. This converts the cutoff into that epoch.
    // Chrome timestamps are microseconds since 1601; convert the cutoff into that epoch.
    const days = opts.days ?? 90
    const cutoff = Math.round((Date.now() / 1000 + 11_644_473_600 - days * 86_400) * 1_000_000)
    const host = `case when instr(substr(url, instr(url,'://')+3), '/') > 0
             then substr(substr(url, instr(url,'://')+3), 1, instr(substr(url, instr(url,'://')+3), '/') - 1)
             else substr(url, instr(url,'://')+3) end`
    const q = (sql: string): string[][] =>
      execFileSync('sqlite3', ['-separator', '\u0001', copy, sql], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
        .split('\n').filter(Boolean).map((l) => l.split('\u0001'))

    // Totals per host.
    const totals = q(`select ${host} as h, sum(visit_count), count(*) from urls
      where last_visit_time > ${cutoff} and url like 'http%'
      group by h having sum(visit_count) >= 5 order by sum(visit_count) desc limit 60;`)

    // The best-known title per host, fetched separately — a correlated subquery
    // over this table is slow enough to look like a hang on a 40MB history.
    const titles = new Map<string, string>()
    for (const [h, title] of q(`select ${host} as h, title from urls
      where last_visit_time > ${cutoff} and url like 'http%' and title != ''
      group by h having visit_count = max(visit_count);`)) {
      if (h && title) titles.set(h, title)
    }

    return totals.map(([h, visits, urls]) => ({
      host: h ?? '', visits: Number(visits ?? 0), urls: Number(urls ?? 0), title: (titles.get(h ?? '') ?? '').trim(),
    })).filter((r) => r.host && !LOCAL.test(r.host))
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

const LOCAL = /^(localhost|127\.|0\.0\.0\.0|\[|.*\.local$)/i

/**
 * Hosts that say nothing durable, or that a "works on" claim would get wrong.
 *
 * This used to be a list of sixty brands. It encoded one particular life —
 * Western and Indian consumer apps, the tools we happened to use — and a person
 * whose day runs on anything else got nothing, silently. A table cannot be
 * wrong in a way anyone notices; it is just blind.
 *
 * The signal it was reaching for is derivable. Building something means
 * returning to the same pages over and over: a staging URL, a dashboard, a
 * route you are debugging. Using a service means visiting many different pages
 * once — a search, a doc, a profile, a video. So depth per page separates them,
 * measured against this person's own browsing rather than a list of ours.
 *
 * Measured on real history: the product someone builds sits around 15 visits
 * per distinct page, while every platform — search, mail, docs, social, video —
 * sits between 1 and 4.
 */
const GENERIC = /(^|\.)(google|googleusercontent|gstatic|accounts\.google)\./i

/** Sites that are infrastructure for the browser itself, not places someone goes. */
const PLUMBING = /(^|\.)(gstatic|googleusercontent|googleapis|cloudflare|cdn|akamai|doubleclick|googletagmanager|sentry|segment)\./i

/**
 * How deeply someone uses a host, relative to how they use everything else.
 *
 * Returns a ratio where 1 is typical for this person. A number well above 1
 * means they return to the same pages — which is what working on something
 * looks like from the outside.
 */
/** The middle number of distinct pages across this person's sites. */
export function medianUrls(all: SiteRow[]): number {
  const counts = all.map((r) => r.urls).sort((a, b) => a - b)
  return counts[Math.floor(counts.length / 2)] ?? 1
}

export function depthRatio(row: SiteRow, all: SiteRow[]): number {
  const depths = all.filter((r) => r.urls >= 5).map((r) => r.visits / r.urls)
  if (depths.length < 3) return 1
  const sorted = [...depths].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]!
  return median > 0 ? row.visits / Math.max(1, row.urls) / median : 1
}

/** Hosts whose presence says something specific about how someone works. */
const TOOLS: { re: RegExp; claim: (host: string) => string; topic: string }[] = [
  { re: /^github\.com$/i, claim: () => 'Uses GitHub for source control day to day', topic: 'tools' },
  { re: /^(gitlab|bitbucket)\./i, claim: (h) => `Uses ${h.split('.')[0]} for source control`, topic: 'tools' },
  { re: /^(linear|asana|jira|monday|clickup)\./i, claim: (h) => `Tracks work in ${cap(h.split('.')[0]!)}`, topic: 'tools' },
  { re: /^(figma)\./i, claim: () => 'Designs in Figma', topic: 'tools' },
  { re: /^(notion|coda)\./i, claim: (h) => `Keeps documentation in ${cap(h.split('.')[0]!)}`, topic: 'tools' },
  { re: /^(vercel|netlify|railway|fly)\./i, claim: (h) => `Deploys on ${cap(h.split('.')[0]!)}`, topic: 'tools' },
  { re: /^(etherscan|sepolia\.etherscan|basescan)\./i, claim: () => 'Works with Ethereum contracts and reads block explorers', topic: 'tools' },
  { re: /^(stackoverflow|news\.ycombinator)\./i, claim: (h) => `Reads ${h.includes('ycombinator') ? 'Hacker News' : 'Stack Overflow'} regularly`, topic: 'interests' },
]

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * A host that is plausibly a product someone *works on*.
 *
 * The bar is high on purpose. A wrong claim ("works on Google Meet") is worse
 * than a missing one: it is unfalsifiable noise in a namespace meant to be
 * citable. So this requires heavy, sustained, deep use of a host that is not a
 * known platform — and even then the claim is hedged to what the evidence
 * supports: "spends significant time on", not "is employed by".
 */
function projectClaim(row: SiteRow, topVisits: number, scale = 1, all: SiteRow[] = []): string | null {
  // Plumbing is never a place someone goes, and a host with a known tool claim
  // has already said something more specific than "works on".
  if (PLUMBING.test(row.host) || GENERIC.test(row.host) || TOOLS.some((t) => t.re.test(row.host))) return null
  // Deep use: many pages, not one page refreshed; and a real share of all browsing.
  // `scale` lowers the bar proportionately for a short window, where nobody has 150 visits.
  if (row.visits < POLICY.chrome.min * scale || row.urls < Math.max(4, POLICY.chrome.minPages * scale)) return null
  // Share-of-browsing only applies to the long window. In a short one a new
  // project cannot out-visit a site you have used all year, and waiting for it
  // to do so is exactly the lag that made this feel static.
  if (scale === 1 && row.visits < topVisits * POLICY.chrome.topShare) return null
  // And the thing the brand list was really testing for: returning to the same
  // pages, well above how this person uses everything else.
  //
  // Depth only separates building from using over a long window. Measured over
  // three days everything is deep — there has been no time to browse widely, so
  // an inbox checked hourly scores higher than the product someone builds. In
  // the short window the test is breadth instead: a project has many distinct
  // pages because it has routes and records, while a service refreshed all day
  // has few.
  if (scale === 1 && all.length >= 6 && depthRatio(row, all) < POLICY.chrome.depthRatio) return null
  const name = row.title.split(/[|·—–]/)[0]?.trim().replace(/\s+(for|by|—).*$/i, '')
  const label = name && name.length > 2 && name.length < 36 ? name : row.host.replace(/^www\./, '')
  return `Works on ${label} (${row.host})`
}

export type ChromeFinding = { text: string; topic: string; evidence: string; host: string; visits: number }

/**
 * Turn history into durable claims.
 *
 * Only two shapes, both about *patterns*: the products someone works on, and the
 * tools they use. Everything else is browsing, and browsing is not knowledge.
 */
/**
 * Claims from browsing.
 *
 * The short window exists for one thing: a project started this week, which a
 * 90-day total cannot see yet. It is not a second opinion on sites someone has
 * used all year — over three days everything looks deep, because there has been
 * no time to browse widely, and an inbox checked hourly out-scores any project.
 * That is how "Works on Home / X" and "Works on Feed (linkedin.com)" appeared:
 * the depth test that keeps them out of the long window cannot work in a short
 * one.
 *
 * So `established` names the hosts the long window already considered. The
 * short window stays quiet about them and speaks only about what is new.
 */
export function findings(rows: SiteRow[], opts: { minVisits?: number; scale?: number; established?: Set<string> } = {}): ChromeFinding[] {
  const min = opts.minVisits ?? 25
  const scale = opts.scale ?? 1
  const top = rows[0]?.visits ?? 0
  const out: ChromeFinding[] = []
  for (const row of rows) {
    if (row.visits < min) continue
    const tool = TOOLS.find((t) => t.re.test(row.host))
    if (tool) { out.push({ text: tool.claim(row.host), topic: tool.topic, evidence: `${row.visits} visits in the period`, host: row.host, visits: row.visits }); continue }
    // In the short window, a host the long window already knows is not news.
    const isNew = !opts.established || !opts.established.has(row.host)
    const project = isNew ? projectClaim(row, top, scale, rows) : null
    if (project) out.push({ text: project, topic: 'projects', evidence: `${row.visits} visits across ${row.urls} pages`, host: row.host, visits: row.visits })
  }
  return out
}

/** Package a finding as an event, citing the browser and the evidence behind it. */
export function toEvent(f: ChromeFinding, profile: string): ConnectorEvent {
  return {
    connector: 'chrome', sourceName: 'Chrome history', sourceKind: 'application',
    text: f.text, actor: 'you', ref: `https://${f.host}`,
    trigger: `${f.evidence} (${profile})`, context: f.host,
    at: new Date().toISOString(),
  }
}
