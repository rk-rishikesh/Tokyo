/**
 * The engine must not depend on the app.
 *
 * Two products live here: `engine/` is the knowledge network, and `app/` is the
 * demo built on it. That split is only real if the dependency arrow points one
 * way — the moment a protocol package imports a connector, the protocol stops
 * being usable without the demo and the separation is decoration.
 *
 * The same rule binds `agents/`. Agent B exists to prove that someone other
 * than the app can read a person's memory; if it imported the app, the proof
 * would be that the app can read its own data.
 *
 * Folders do not enforce this. This does.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const APP_PACKAGES = new Set(readdirSync(join(root, 'app')).map((d) => `@knowledge01/${d}`))

const sourceFiles = (dir: string): string[] => {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (['node_modules', 'dist', '.next', 'out'].includes(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

const violations: string[] = []

const GUARDED = ['engine', 'agents']
const packages = GUARDED.flatMap((top) => {
  try { return readdirSync(join(root, top)).map((pkg) => ({ top, pkg })) } catch { return [] }
})

for (const { top, pkg } of packages) {
  const dir = join(root, top, pkg)
  if (!statSync(dir).isDirectory()) continue

  // Declared dependencies.
  try {
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>; devDependencies?: Record<string, string>
    }
    for (const dep of [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})]) {
      if (APP_PACKAGES.has(dep)) violations.push(`${top}/${pkg}/package.json depends on ${dep}`)
    }
  } catch { /* a package without a manifest is not a layering problem */ }

  // Actual imports, which are what really bind the two together.
  for (const file of sourceFiles(dir)) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const spec = m[1]!
      if (APP_PACKAGES.has(spec) || spec.includes('/app/') || spec.startsWith('../../app/')) {
        violations.push(`${file.replace(root, '')} imports ${spec}`)
      }
    }
  }
}

if (violations.length) {
  console.error('engine/ and agents/ must not depend on app/:\n')
  for (const v of violations) console.error(`  ${v}`)
  console.error('\nThe engine is a protocol. It has to work without the demo.')
  process.exit(1)
}
console.log(`engine/ and agents/ are clean — no dependency on app/ (${packages.length} packages checked against ${APP_PACKAGES.size} app packages)`)
