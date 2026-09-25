/**
 * Claude Code — which projects you bring an AI agent to, and how much.
 *
 * `~/.claude/projects/<encoded-path>/*.jsonl` is one directory per project and
 * one file per session. This reader uses the directory names and the file
 * metadata, and never opens a session file.
 *
 * That is a deliberate line, not an oversight. Those files contain every prompt
 * you have typed and every reply you got, and "what you asked an AI at 2am" is
 * the most sensitive thing on this machine. Session *counts* are a durable fact
 * about what you work on; session *contents* are a transcript, and a namespace
 * built for provenance is exactly the wrong place for one. Nothing downstream
 * can put it back, because it is never read.
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { Finding } from './local-sources.js'
import { POLICY } from './policy.js'

export const claudeProjectsDir = (): string | null => {
  const p = join(homedir(), '.claude', 'projects')
  return existsSync(p) ? p : null
}

export type AgentProject = { name: string; path: string; sessions: number; lastAt: string; recentSessions: number }

/**
 * Projects with agent sessions, most recently used first.
 *
 * Directory names encode the project path (`-Users-you-Projects-tokyo`), so the
 * project name is the last segment and the real path is recoverable — which
 * matters, because a directory that no longer exists on disk is a project you
 * have stopped working on, not a fact about you now.
 */
export function agentProjects(dir = claudeProjectsDir(), opts: { recentDays?: number } = {}): AgentProject[] {
  if (!dir) return []
  const recentDays = opts.recentDays ?? POLICY['claude-code'].windowDays
  const recentMs = Date.now() - recentDays * 86_400_000
  const out: AgentProject[] = []

  for (const entry of readdirSync(dir)) {
    if (!entry.startsWith('-')) continue
    const full = join(dir, entry)
    let files: string[]
    try { files = readdirSync(full).filter((f) => f.endsWith('.jsonl')) } catch { continue }
    if (!files.length) continue

    // "-Users-rishikesh-Projects-tokyo" → "/Users/rishikesh/Projects/tokyo"
    const path = entry.replace(/-/g, '/')
    const name = basename(path)
    // The home directory itself, or a bare "Projects", is not a project.
    if (name.length < 2 || ['Projects', basename(homedir())].includes(name)) continue
    if (!existsSync(path)) continue

    let last = 0
    let recent = 0
    for (const f of files) {
      try {
        const m = statSync(join(full, f)).mtimeMs
        if (m > last) last = m
        if (m >= recentMs) recent++
      } catch { /* a file that vanished mid-read is not worth failing the pass for */ }
    }
    out.push({ name, path, sessions: files.length, lastAt: new Date(last).toISOString(), recentSessions: recent })
  }
  return out.sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt))
}

/**
 * Claims from agent usage.
 *
 * Two sessions is someone trying something; sustained use is a project. The
 * recent window is what makes this react — a project picked up this week clears
 * the bar on recency even though its total is small.
 */
export function findings(projects: AgentProject[], recentDays = POLICY['claude-code'].windowDays): Finding[] {
  const out: Finding[] = []
  for (const p of projects) {
    const sustained = p.sessions >= POLICY['claude-code'].minSustained
    const active = p.recentSessions >= POLICY['claude-code'].min
    if (!sustained && !active) continue
    out.push({
      text: `Works on the ${p.name} project`,
      topic: 'projects',
      evidence: active
        ? `${p.recentSessions} agent sessions in the last ${recentDays} days`
        : `${p.sessions} agent sessions`,
      ref: p.path,
    })
  }
  if (projects.reduce((n, p) => n + p.sessions, 0) >= 10) {
    out.push({ text: 'Uses Claude Code for day-to-day development', topic: 'tools', evidence: `${projects.length} projects with agent sessions`, ref: 'https://claude.com/claude-code' })
  }
  return out
}
