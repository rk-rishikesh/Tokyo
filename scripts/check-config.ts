/**
 * No placeholder identity may reach a real user.
 *
 * `acme.eth`, `demo.eth` and `recalltest.eth` are test fixtures and live
 * demo namespaces. In a test they are fine. In the product path they are a
 * stranger's memory being written somewhere nobody controls — which already
 * happened once, when a missing CONNECT_OWNER sent a person's browsing history
 * into a namespace named after an example company.
 *
 * Marketing pages may name them: an illustration of what a namespace looks like
 * is not an identity the code will write to. So this checks the code that runs,
 * not the copy that describes it.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname

const PLACEHOLDERS = [/\bacme\.eth\b/, /\bdemo\.eth\b/, /\brecalltest\.eth\b/, /\bworldhistory\.eth\b/]

/** Where a placeholder would be a real default rather than an example. */
const CODE_PATHS = ['app/connect/src', 'app/console/lib', 'app/console/app/api', 'app/console/app/app']

const files = (dir: string): string[] => {
  const out: string[] = []
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return out }
  for (const entry of entries) {
    if (['node_modules', '.next', '.next-verify', 'dist', 'legacy', 'test'].includes(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...files(full))
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

const problems: string[] = []

for (const dir of CODE_PATHS) {
  for (const file of files(join(root, dir))) {
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      // A comment explaining the shape of a namespace is documentation, not a
      // default. Only executable code can write somewhere.
      const code = line
        .replace(/\/\/.*$/, '')
        .replace(/^\s*\*.*$/, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
      if (!code.trim()) return
      for (const re of PLACEHOLDERS) {
        if (re.test(code)) problems.push(`${file.replace(root, '')}:${i + 1}  ${line.trim().slice(0, 100)}`)
      }
    })
  }
}

if (problems.length) {
  console.error('placeholder identities in the product path:\n')
  for (const p of problems) console.error(`  ${p}`)
  console.error('\nThese are fixtures. Code that runs for a real person must not name one.')
  process.exit(1)
}
console.log(`no placeholder identities in ${CODE_PATHS.length} code paths`)
