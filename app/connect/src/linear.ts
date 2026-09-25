/**
 * Linear — which teams and projects someone actually works in.
 *
 * Linear's OAuth offers one read scope and no narrower one, so this token can
 * technically read every issue title in the workspace. The restraint therefore
 * has to live here, in what the reader asks for and keeps.
 *
 * What it keeps: team names, project names, and how many issues the person is
 * assigned in each. Those are durable facts about what someone works on.
 *
 * What it never keeps: issue titles, descriptions, comments, or anything about
 * other people's issues. A title like "Fix auth bypass before Tuesday's audit"
 * is exactly the kind of thing a namespace built for provenance must not be
 * carrying around, and the query below never selects the field at all — so
 * nothing downstream can leak what was never fetched.
 */
import type { Finding } from './local-sources.js'

type Gql<T> = { data?: T; errors?: { message: string }[] }

async function gql<T>(token: string, query: string): Promise<T> {
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    // Linear takes the raw token, not a Bearer prefix.
    headers: { authorization: token, 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`linear: ${res.status}`)
  const j = (await res.json()) as Gql<T>
  if (j.errors?.length) throw new Error(`linear: ${j.errors[0]!.message}`)
  if (!j.data) throw new Error('linear: empty response')
  return j.data
}

export type LinearTeam = { name: string; key: string; issues: number }
export type LinearProject = { name: string; state: string; issues: number }

type ViewerData = {
  viewer: {
    assignedIssues: {
      nodes: {
        // Deliberately no `title`, `description` or `comments`. Adding one here
        // is the change that turns this from a fact about someone's work into a
        // copy of their issue tracker.
        team: { name: string; key: string } | null
        project: { name: string; state: string } | null
      }[]
    }
  }
}

/**
 * Teams and projects the person is assigned work in, over their recent issues.
 *
 * Assigned issues rather than all issues: what someone is responsible for is a
 * fact about them, whereas what exists in their workspace is a fact about their
 * employer.
 */
export async function workload(token: string, opts: { max?: number } = {}): Promise<{ teams: LinearTeam[]; projects: LinearProject[] }> {
  const max = Math.min(opts.max ?? 100, 250)
  const data = await gql<ViewerData>(token, `{
    viewer {
      assignedIssues(first: ${max}, orderBy: updatedAt) {
        nodes { team { name key } project { name state } }
      }
    }
  }`)

  const teams = new Map<string, LinearTeam>()
  const projects = new Map<string, LinearProject>()
  for (const n of data.viewer.assignedIssues.nodes) {
    if (n.team) {
      const cur = teams.get(n.team.key) ?? { name: n.team.name, key: n.team.key, issues: 0 }
      teams.set(n.team.key, { ...cur, issues: cur.issues + 1 })
    }
    if (n.project) {
      const cur = projects.get(n.project.name) ?? { name: n.project.name, state: n.project.state, issues: 0 }
      projects.set(n.project.name, { ...cur, issues: cur.issues + 1 })
    }
  }
  return {
    teams: [...teams.values()].sort((a, b) => b.issues - a.issues),
    projects: [...projects.values()].sort((a, b) => b.issues - a.issues),
  }
}

/**
 * Claims from Linear activity.
 *
 * Three assigned issues is the bar: one or two is someone being cc'd, not a
 * team they work in. Completed and cancelled projects are dropped — what
 * somebody shipped last quarter is history, not a fact about what they do now.
 */
export function findings(w: { teams: LinearTeam[]; projects: LinearProject[] }): Finding[] {
  const out: Finding[] = []
  for (const t of w.teams) {
    if (t.issues < 3) continue
    out.push({
      text: `Works on the ${t.name} team`,
      topic: 'projects',
      evidence: `${t.issues} assigned issues`,
      ref: 'https://linear.app',
    })
  }
  for (const p of w.projects.slice(0, 5)) {
    if (p.issues < 3) continue
    if (['completed', 'canceled', 'cancelled'].includes(p.state.toLowerCase())) continue
    out.push({
      text: `Works on the ${p.name} project`,
      topic: 'projects',
      evidence: `${p.issues} assigned issues in Linear`,
      ref: 'https://linear.app',
    })
  }
  if (w.teams.length) {
    out.push({ text: 'Tracks work in Linear', topic: 'tools', evidence: `${w.teams.reduce((n, t) => n + t.issues, 0)} assigned issues`, ref: 'https://linear.app' })
  }
  return out
}
