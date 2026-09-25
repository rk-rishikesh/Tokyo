/**
 * Local sources: things on this machine that genuinely belong to the person.
 *
 * Every source here reads a real file. There is no sample data anywhere in this
 * package — a connector either reads your data or it does not exist.
 *
 * The rule each reader follows: state the *pattern*, never the log. Which tools
 * you use and which projects you work on are durable facts a second party would
 * want the source of. What you typed at 14:03 on Tuesday is not knowledge, it is
 * surveillance with a version history.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

export type Finding = {
  text: string
  topic: string
  evidence: string
  ref?: string
  /**
   * Set when this rests on a single observation — one meeting, one commit.
   * Still worth keeping, but not worth the confidence of a counted pattern.
   */
  weak?: boolean
}

// ---------------------------------------------------------------------------
// VS Code / Cursor — which projects you actually open
// ---------------------------------------------------------------------------

export type EditorProfile = { name: string; storage: string }

export function editorProfiles(): EditorProfile[] {
  const home = homedir()
  return [
    { name: 'VS Code', storage: join(home, 'Library/Application Support/Code/User/globalStorage/storage.json') },
    { name: 'VS Code', storage: join(home, '.config/Code/User/globalStorage/storage.json') },
    { name: 'Cursor', storage: join(home, 'Library/Application Support/Cursor/User/globalStorage/storage.json') },
    { name: 'Windsurf', storage: join(home, 'Library/Application Support/Windsurf/User/globalStorage/storage.json') },
  ].filter((p) => existsSync(p.storage))
}

/** Folder paths the editor remembers, most recent first. */
export function editorWorkspaces(storagePath: string): string[] {
  const raw = readFileSync(storagePath, 'utf8')
  const uris = [...raw.matchAll(/"file:\/\/([^"]+)"/g)].map((m) => decodeURIComponent(m[1] ?? ''))
  const seen = new Set<string>()
  return uris.filter((u) => u && !u.includes('/.') && !seen.has(u) && seen.add(u))
}

/**
 * Projects you work on, from the folders your editor keeps reopening.
 *
 * Only folders that still exist and look like real projects — an editor
 * remembers everything you ever opened, and a folder deleted months ago is not
 * a fact about you now.
 */
export function editorFindings(storagePath: string, editor: string): Finding[] {
  const home = homedir()
  const out: Finding[] = []
  for (const path of editorWorkspaces(storagePath).slice(0, 12)) {
    if (!existsSync(path)) continue
    const isProject = ['package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml', 'requirements.txt', '.git'].some((f) => existsSync(join(path, f)))
    if (!isProject) continue
    const name = basename(path)
    if (name.length < 2) continue
    out.push({
      text: `Works on the ${name} project`,
      topic: 'projects',
      evidence: `open in ${editor} at ${path.replace(home, '~')}`,
      ref: path,
    })
  }
  return out
}

/** The stack of a project, from what its manifest declares. */
export function projectStack(path: string): Finding[] {
  const pkgPath = join(path, 'package.json')
  if (!existsSync(pkgPath)) return []
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; packageManager?: string }
    const name = pkg.name ?? basename(path)
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    const out: Finding[] = []
    const KNOWN: [string, string][] = [
      ['next', 'Next.js'], ['react', 'React'], ['vue', 'Vue'], ['svelte', 'Svelte'],
      ['typescript', 'TypeScript'], ['vitest', 'Vitest'], ['jest', 'Jest'], ['viem', 'viem'],
      ['ethers', 'ethers.js'], ['tailwindcss', 'Tailwind CSS'], ['express', 'Express'], ['fastify', 'Fastify'],
    ]
    const found = KNOWN.filter(([k]) => k in deps).map(([, label]) => label)
    if (found.length) out.push({ text: `The ${name} project is built with ${found.slice(0, 5).join(', ')}`, topic: 'projects', evidence: `declared in ${basename(path)}/package.json`, ref: pkgPath })
    // Phrased exactly as the shell reader phrases it, so the same tool noticed by
    // two sources becomes one claim with two sources rather than two claims.
    if (pkg.packageManager?.startsWith('pnpm')) out.push({ text: 'Uses pnpm regularly', topic: 'tools', evidence: `packageManager in ${basename(path)}/package.json`, ref: pkgPath })
    return out
  } catch { return [] }
}

// ---------------------------------------------------------------------------
// Shell history — which tools you actually run
// ---------------------------------------------------------------------------

export function shellHistoryPath(): string | null {
  for (const f of ['.zsh_history', '.bash_history']) {
    const p = join(homedir(), f)
    if (existsSync(p)) return p
  }
  return null
}

const TOOL_LABELS: Record<string, string> = {
  pnpm: 'pnpm', npm: 'npm', yarn: 'yarn', bun: 'bun',
  git: 'git', docker: 'Docker', kubectl: 'Kubernetes', terraform: 'Terraform',
  cargo: 'Cargo (Rust)', go: 'Go', python3: 'Python', pip: 'Python', ruby: 'Ruby',
  forge: 'Foundry', cast: 'Foundry', hardhat: 'Hardhat', vercel: 'Vercel', gh: 'the GitHub CLI',
  psql: 'PostgreSQL', sqlite3: 'SQLite', ffmpeg: 'ffmpeg', ipfs: 'IPFS',
}

/**
 * Tools you use, from how often you actually invoke them.
 *
 * Reads command *names* only — never arguments, which carry paths, hostnames
 * and sometimes secrets.
 */
export function shellFindings(path: string, opts: { min?: number } = {}): Finding[] {
  const min = opts.min ?? 10
  let raw: string
  try { raw = readFileSync(path, 'utf8') } catch { return [] }
  const counts = new Map<string, number>()
  for (const line of raw.split('\n')) {
    // zsh extended history: ": 1700000000:0;the command"
    const cmd = line.replace(/^:\s*\d+:\d+;/, '').trim().split(/\s+/)[0] ?? ''
    const bare = basename(cmd)
    if (!bare || !(bare in TOOL_LABELS)) continue
    counts.set(bare, (counts.get(bare) ?? 0) + 1)
  }
  const byLabel = new Map<string, number>()
  for (const [cmd, n] of counts) {
    const label = TOOL_LABELS[cmd]!
    byLabel.set(label, (byLabel.get(label) ?? 0) + n)
  }
  return [...byLabel.entries()]
    .filter(([, n]) => n >= min)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([label, n]) => ({ text: `Uses ${label} regularly`, topic: 'tools', evidence: `${n} invocations in shell history` }))
}

/** Which local sources are present on this machine right now. */
export function availableSources(): { id: string; present: boolean; detail: string }[] {
  const editors = editorProfiles()
  const shell = shellHistoryPath()
  return [
    { id: 'editor', present: editors.length > 0, detail: editors.length ? editors.map((e) => e.name).join(', ') : 'no VS Code or Cursor profile found' },
    { id: 'shell', present: !!shell, detail: shell ? shell.replace(homedir(), '~') : 'no shell history found' },
  ]
}
