/**
 * Clear local demo state so the journey starts from nothing.
 *
 * Everything this removes is derived: repositories the agent wrote, the users
 * and grants behind them, the activity log, and dynamically registered OAuth
 * clients. All of it is rebuilt by connecting a wallet and a source.
 *
 * It does not touch the chain. There are no contracts of ours to redeploy —
 * the write path uses ENS's own registries and resolvers, and a name already
 * registered on Sepolia stays registered. What a reset can do is forget
 * everything this machine believes, which is what makes a first run look like a
 * first run.
 *
 * Nor does it touch the knowledge network (`~/.knowledge-network`). That is
 * the stand-in for IPFS and ENS, and leaving it is the point: this script is
 * how you delete the company, and what survives is what Agent B still reads.
 * Owner keys (public halves only) go too; signing again restores them.
 *
 *   pnpm reset:local            # say what would go
 *   pnpm reset:local --apply    # do it
 */
import { existsSync, readdirSync, rmSync, statSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const apply = process.argv.includes('--apply')
const base = process.env.RECALL_CACHE_DIR ?? '~/.recall'
const root = base.startsWith('~') ? join(homedir(), base.slice(1)) : resolve(base)

if (!existsSync(root)) {
  console.log(`nothing at ${root} — already clean`)
  process.exit(0)
}

const targets: { path: string; what: string }[] = []

const repos = join(root, 'repos')
if (existsSync(repos)) {
  for (const ns of readdirSync(repos)) targets.push({ path: join(repos, ns), what: `namespace ${ns}` })
}

const users = join(root, 'users')
if (existsSync(users)) {
  for (const f of readdirSync(users)) targets.push({ path: join(users, f), what: `user file ${f}` })
}

const ownerKeys = join(root, 'owner-keys')
if (existsSync(ownerKeys)) targets.push({ path: ownerKeys, what: 'owner public keys' })

for (const f of ['connect-activity.json', 'agent-grants.json', 'oauth-clients.json']) {
  const p = join(root, f)
  if (existsSync(p)) targets.push({ path: p, what: f })
}

if (!targets.length) {
  console.log(`${root} is already clean`)
  process.exit(0)
}

console.log(`${apply ? 'Removing' : 'Would remove'} ${targets.length} item(s) from ${root}:\n`)
for (const t of targets) console.log(`  ${t.what}`)

if (!apply) {
  console.log('\nNothing was deleted. Re-run with --apply to do it.')
  console.log('Registered ENS names are untouched — this only forgets what this machine derived.')
  process.exit(0)
}

for (const t of targets) {
  if (statSync(t.path).isDirectory()) rmSync(t.path, { recursive: true, force: true })
  else unlinkSync(t.path)
}
console.log(`\nDone. Connect a wallet at /app and the journey starts from nothing.`)
console.log('The knowledge network was left alone — `pnpm agent-b:read` still reads whatever was granted.')
