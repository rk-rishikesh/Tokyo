/**
 * The published entry points must be real, and the workspace must not use them.
 *
 * Adding an `exports` map that points at `dist/` is how a package becomes
 * installable — and also how a workspace silently breaks, because tsc, webpack
 * and vitest each pick entry points their own way. Getting one of them wrong
 * fails at build time in a way that looks unrelated to packaging.
 *
 * This checks both halves: every published path is one the build actually
 * emits, and every resolver in this repo is configured to prefer source.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const problems: string[] = []

for (const pkg of readdirSync(join(root, 'engine'))) {
  const manifestPath = join(root, 'engine', pkg, 'package.json')
  if (!existsSync(manifestPath)) continue
  const m = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    private?: boolean
    exports?: Record<string, unknown>
    files?: string[]
  }
  if (m.private) continue

  if (!m.files?.includes('dist')) problems.push(`engine/${pkg}: "files" must include dist`)

  for (const [key, value] of Object.entries(m.exports ?? {})) {
    if (typeof value === 'string') {
      // Asset re-exports (abis) are fine as plain strings; source is not.
      if (value.includes('/src/')) problems.push(`engine/${pkg}: exports["${key}"] ships source (${value})`)
      continue
    }
    const v = value as Record<string, string>
    if (!v.development) problems.push(`engine/${pkg}: exports["${key}"] has no "development" condition — the workspace would resolve to dist/`)
    if (!v.types || !v.default) problems.push(`engine/${pkg}: exports["${key}"] needs "types" and "default"`)
    if (v.development && !existsSync(join(root, 'engine', pkg, v.development))) {
      problems.push(`engine/${pkg}: exports["${key}"].development points at a file that does not exist (${v.development})`)
    }
  }
}

// Every resolver used in this repo has to be told to prefer source.
const base = JSON.parse(readFileSync(join(root, 'tsconfig.base.json'), 'utf8')) as { compilerOptions?: { customConditions?: string[] } }
if (!base.compilerOptions?.customConditions?.includes('development')) {
  problems.push('tsconfig.base.json: customConditions must include "development"')
}
const consoleTs = JSON.parse(readFileSync(join(root, 'app/console/tsconfig.json'), 'utf8')) as { compilerOptions?: { customConditions?: string[] } }
if (!consoleTs.compilerOptions?.customConditions?.includes('development')) {
  problems.push('app/console/tsconfig.json: customConditions must include "development"')
}
if (!readFileSync(join(root, 'app/console/next.config.mjs'), 'utf8').includes("conditionNames")) {
  problems.push('app/console/next.config.mjs: webpack resolve.conditionNames must prefer "development"')
}

// Node runs TypeScript directly in several scripts. It applies "exports" like
// any consumer would, so without the condition it looks for a dist/ that a
// source checkout has not built — and the error names a missing file rather
// than the packaging decision that caused it.
for (const manifest of ['package.json', 'engine/cli/package.json', 'engine/mcp/package.json']) {
  const m = JSON.parse(readFileSync(join(root, manifest), 'utf8')) as { scripts?: Record<string, string> }
  for (const [name, cmd] of Object.entries(m.scripts ?? {})) {
    const runsSource = /(^|\s)tsx\s/.test(cmd) || cmd.includes('--import tsx')
    if (runsSource && !cmd.includes('--conditions=development')) {
      problems.push(`${manifest}: script "${name}" runs TypeScript without --conditions=development`)
    }
  }
}

// A 'use client' component that imports the connect package root pulls the
// readers into the browser bundle — they reach for node:child_process and
// node:crypto, and the build fails with an error naming a scheme rather than
// the import that caused it.
const clientFiles = (dir: string): string[] => {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (['node_modules', '.next', '.next-verify', 'dist'].includes(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...clientFiles(full))
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}
for (const file of clientFiles(join(root, 'app/console'))) {
  const src = readFileSync(file, 'utf8')
  if (!/^['"]use client['"]/m.test(src)) continue
  if (/from ['"]@knowledge01\/connect['"]/.test(src)) {
    problems.push(`${file.replace(root, '')} is a client component importing the @knowledge01/connect root — use a subpath such as @knowledge01/connect/workspaces`)
  }
}

if (problems.length) {
  console.error('packaging problems:\n')
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}
console.log('packaging is consistent — published entry points exist, and every resolver prefers source')
