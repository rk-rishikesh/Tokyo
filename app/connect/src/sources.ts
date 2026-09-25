/**
 * The sources, registered.
 *
 * One entry each, in the order they should appear. Each says what it needs and
 * how to read it; nothing else in the package knows that Chrome is a SQLite
 * file or that Granola speaks MCP.
 *
 * Importing this module is what makes the sources exist — `watch.ts` imports it
 * for the side effect, the same way a plugin registry works. A new source is
 * this file plus its reader, and nothing else.
 */
import { chromeProfiles, findings as chromeFindings, readHistory } from './chrome.js'
import { agentProjects, findings as claudeCodeFindings, claudeProjectsDir } from './claude-code.js'
import { activeRepos, findings as githubFindings, githubToken } from './github.js'
import { calendarFindings, gmailFindings, mailServices, recurringMeetings } from './google.js'
import { findings as granolaFindings, meetings as granolaMeetings } from './granola.js'
import { findings as linearFindings, workload } from './linear.js'
import {
  editorFindings, editorProfiles, projectStack, shellFindings, shellHistoryPath,
  type Finding,
} from './local-sources.js'
import { extractFromBrowsing, extractFromProjects } from './llm.js'
import { POLICY } from './policy.js'
import { ACTIVITY_FILES, fetchArchive } from './archive.js'
import {
  clearJob, initiate, orderFindings, parseActivity, pendingJob, rememberJob,
  state as archiveState, watchFindings,
} from './takeout.js'
import { findings as ethereumFindings, walletActivity } from './ethereum.js'
import { register, type ReadContext, type SourceFinding } from './registry.js'

const rules = (from: string, f: Finding, host?: string): SourceFinding =>
  ({ ...f, by: 'rules', from, ...(host ? { host } : {}) })
const model = (from: string, f: Finding, host?: string): SourceFinding =>
  ({ ...f, by: 'model', from, ...(host ? { host } : {}) })

/**
 * A model read that must not cost the rule-based findings.
 *
 * The rules are free and deterministic; the model is neither. A rate limit or a
 * malformed reply should lose the claims only the model could have found, never
 * the ones already in hand.
 */
async function alsoModel(
  from: string,
  run: () => Promise<Finding[]>,
  host?: (f: Finding) => string | undefined,
): Promise<SourceFinding[]> {
  try {
    return (await run()).map((f) => model(from, f, host?.(f)))
  } catch (e) {
    console.warn(`  ${from}: model extraction failed — ${e instanceof Error ? e.message : String(e)}`)
    return []
  }
}

register({
  id: 'chrome',
  requires: 'local',
  available: () => chromeProfiles().length > 0,
  async read(ctx: ReadContext) {
    const profile = chromeProfiles()[0]!
    const long = readHistory(profile.path, { days: POLICY.chrome.windowDays })
    const recent = readHistory(profile.path, { days: ctx.recentDays ?? POLICY.chrome.recentDays })
    const out: SourceFinding[] = []
    // Two windows: one that establishes durable patterns, one that reacts to
    // today. The bar scales with the window — in three days nobody has 150
    // visits, so a short window with a long window's threshold sees nothing.
    // The short window speaks only about hosts the long window has not already
    // judged — its job is a project started this week, not a second opinion on
    // a site used all year.
    const established = new Set(long.map((r) => r.host))
    for (const f of [...chromeFindings(long), ...chromeFindings(recent, { minVisits: 8, scale: 0.25, established })]) {
      out.push(rules('Browser history', { text: f.text, topic: f.topic, evidence: f.evidence, ref: `https://${f.host}` }, f.host))
    }
    if (ctx.model) {
      out.push(...await alsoModel('Browser history', () => extractFromBrowsing(long, ctx.model!), (f) => f.ref?.replace('https://', '')))
    }
    return out
  },
})

register({
  id: 'editor',
  requires: 'local',
  available: () => editorProfiles().length > 0,
  async read(ctx: ReadContext) {
    const profile = editorProfiles()[0]!
    const found = editorFindings(profile.storage, profile.name)
    const out = [...found, ...found.flatMap((f) => (f.ref ? projectStack(f.ref) : []))]
      .map((f) => rules(profile.name, f))
    if (ctx.model) {
      const projects = found.map((f) => ({
        name: f.text.replace(/^Works on the /, '').replace(/ project$/, ''),
        path: f.ref ?? '',
        stack: f.ref ? projectStack(f.ref).map((s) => s.text) : [],
      }))
      out.push(...await alsoModel(profile.name, () => extractFromProjects(projects, ctx.model!)))
    }
    return out
  },
})

register({
  id: 'shell',
  requires: 'local',
  available: () => !!shellHistoryPath(),
  read: () => shellFindings(shellHistoryPath()!).map((f) => rules('Shell history', f, 'shell')),
})

register({
  id: 'claude-code',
  requires: 'local',
  available: () => !!claudeProjectsDir(),
  read: () => claudeCodeFindings(agentProjects()).map((f) => rules('Claude Code', f, 'claude-code')),
})

register({
  id: 'github',
  provider: 'github',
  requires: 'token',
  async read(ctx: ReadContext) {
    // A signed-in person's own token always wins. The `gh` CLI's token is a
    // fallback only for someone running this on their own machine — a hosted
    // visitor must never be served the operator's GitHub account.
    const token = ctx.token ?? (ctx.allowLocalCredentials ? githubToken() : null)
    if (!token) return []
    return githubFindings(await activeRepos(token)).map((f) => rules('GitHub', f, 'github.com'))
  },
})

register({
  id: 'linear',
  provider: 'linear',
  requires: 'token',
  async read(ctx: ReadContext) {
    return linearFindings(await workload(ctx.token!)).map((f) => rules('Linear', f, 'linear.app'))
  },
})

register({
  id: 'granola',
  provider: 'granola',
  requires: 'token',
  async read(ctx: ReadContext) {
    return granolaFindings(await granolaMeetings(ctx.token!)).map((f) => rules('Granola', f, 'granola.ai'))
  },
})

register({
  id: 'takeout',
  // The same Google account as the calendar and mail reader, asked for entirely
  // different scopes. One provider, two sources — because what they read and
  // what they promise are not the same thing, and one consent screen covering
  // both would describe neither.
  provider: 'google',
  requires: 'token',
  async read(ctx: ReadContext) {
    const token = ctx.token!
    // An archive takes minutes to build, so a pass either starts one or reads
    // one that a previous pass started. Asking and answering in the same
    // request is not a shape this API offers.
    const pending = pendingJob(ctx.userId)
    if (!pending) {
      rememberJob(await initiate(token), ctx.userId)
      return []
    }

    const s = await archiveState(token, pending.jobId)
    if (s.state === 'in-progress') return []
    if (s.state === 'failed') {
      clearJob(ctx.userId)
      throw new Error(s.detail)
    }

    const files = await fetchArchive(s.urls, ACTIVITY_FILES)
    clearJob(ctx.userId)

    const out: SourceFinding[] = []
    for (const f of files) {
      const activities = parseActivity(f.json)
      const findings = /youtube/i.test(f.name) ? watchFindings(activities) : orderFindings(activities)
      for (const finding of findings) out.push(rules('Google Takeout', finding, 'myactivity.google.com'))
    }
    return out
  },
})

register({
  id: 'google',
  provider: 'google',
  requires: 'token',
  async read(ctx: ReadContext) {
    const out: SourceFinding[] = []
    // One grant, two independent reads: a Gmail quota error must not cost the
    // calendar claims, or the other way round.
    try {
      for (const f of calendarFindings(await recurringMeetings(ctx.token!))) {
        out.push(rules('Google Calendar', f, 'calendar.google.com'))
      }
    } catch (e) {
      console.warn(`  Google Calendar: ${e instanceof Error ? e.message : String(e)}`)
    }
    try {
      for (const f of gmailFindings(await mailServices(ctx.token!))) {
        out.push(rules('Gmail', f, 'mail.google.com'))
      }
    } catch (e) {
      console.warn(`  Gmail: ${e instanceof Error ? e.message : String(e)}`)
    }
    return out
  },
})

register({
  id: 'ethereum',
  // No token: the address was proven at sign-in, and the chain is public.
  requires: 'wallet',
  async read(ctx: ReadContext) {
    return ethereumFindings(await walletActivity(ctx.wallet!)).map((f) => rules('Ethereum', f, 'eth.blockscout.com'))
  },
})
