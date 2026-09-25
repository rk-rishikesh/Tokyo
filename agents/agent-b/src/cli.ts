/**
 * `pnpm agent-b:read [namespace…]` — the delete-the-company check, by hand.
 *
 * Stop the app, delete `~/.recall`, run this. What prints came from the network
 * and Agent B's own key, because there is nowhere else it could have come from.
 */
import { grants, identity, read } from './agent.js'

const names = process.argv.slice(2).filter((a) => !a.startsWith('-'))
const targets = names.length ? names : [...new Set([...grants().namespaces, ...grants().requested])]
if (!targets.length) {
  console.log('Agent B has not been granted anything yet. Start it with `pnpm agent-b` and request access.')
  process.exit(0)
}

console.log(`Agent B · key ${identity().pubkey.slice(0, 12)}…\n`)
for (const ns of targets) {
  const r = await read(ns)
  if (!r.ok) { console.log(`✗ ${ns}\n    ${r.detail}\n`); continue }
  console.log(`✓ ${ns} · v${r.data.version} · ${r.data.refsCid}`)
  for (const c of r.data.claims) console.log(`    ${c.claim}  — ${c.sources.map((s) => s.name ?? s.type).join(', ')}`)
  console.log()
}
