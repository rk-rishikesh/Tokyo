/**
 * The connected-apps demo, as one command.
 *
 * Starts the connector service on a scratch cache, fires scripted activity from
 * several apps with pauses so a room can follow it, and prints what landed.
 * Everything it shows is a real commit; the simulated connectors are labelled.
 *
 *   pnpm demo:connect            (fresh cache)
 *   pnpm demo:connect --keep     (add to whatever is already there)
 */
import { spawn } from 'node:child_process'
import { rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: {
  keep: { type: 'boolean' }, owner: { type: 'string', default: 'acme.eth' }, port: { type: 'string', default: '4319' },
  /** Publish each namespace to Sepolia as it is written. Needs a key that owns the names. */
  publish: { type: 'boolean' },
} })
const CACHE = join(homedir(), '.recall-demo')
const PORT = values.port!
const base = `http://localhost:${PORT}`

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const ok = (s: string) => `\x1b[32m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

if (!values.keep) { rmSync(CACHE, { recursive: true, force: true }); console.log(dim(`fresh cache at ${CACHE}`)) }

const service = spawn('node', ['app/connect/dist/knowledge-connect.mjs'], {
  env: {
    ...process.env, RECALL_CACHE_DIR: CACHE, CONNECT_OWNER: values.owner!, CONNECT_PORT: PORT,
    // Off unless asked: a demo on a fresh cache owns no names, so publishing would only fail.
    CONNECT_AUTO_PUBLISH: values.publish ? 'true' : 'false',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
service.stdout.on('data', (d: Buffer) => process.stdout.write(dim(`  service: ${String(d).trim()}\n`)))
service.stderr.on('data', (d: Buffer) => process.stderr.write(dim(`  service: ${String(d).trim()}\n`)))

async function main(): Promise<void> {
  await wait(1200)
  console.log(`\n${bold('Connected apps writing into memory you own')}`)
  console.log(dim(`every claim lands in <topic>.${values.owner} — a namespace you control, not the app's database`))
  console.log(dim(values.publish ? 'publishing to Sepolia as it goes, signed with your key\n' : 'writing locally; --publish signs and publishes too\n'))

  // A real Slack slash command: a person typing a convention on purpose.
  console.log(bold('1 · Slack — someone runs /knowledge in #eng'))
  const slack = await fetch(`${base}/slack/events`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ command: '/knowledge', text: 'We use pnpm, not npm — the workspace is a pnpm monorepo', user_name: 'priya', channel_name: 'eng', team_domain: 'acme' }),
  }).then((r) => r.json() as Promise<{ outcome: { status: string; namespace?: string; version?: number } }>)
  console.log(`   ${ok('→')} ${slack.outcome.namespace} v${slack.outcome.version}  ${dim('(real connector)')}\n`)
  await wait(1500)

  // The rest of the workspace, scripted.
  console.log(bold('2 · The rest of the workspace'))
  type SimRow = { event: { sourceName: string; text: string; trigger: string }; outcome: { status: string; namespace?: string; version?: number; merged?: boolean; reason?: string } }
  const sim = (await fetch(`${base}/simulate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ count: 9, from: 0, ...(values.publish ? { publish: 'now' } : {}) }) }).then((r) => r.json())) as { outcomes: SimRow[] }
  for (const { event, outcome } of sim.outcomes) {
    const label = `${event.sourceName}`.padEnd(12)
    if (outcome.status === 'committed') console.log(`   ${ok('→')} ${label} ${String(outcome.namespace).padEnd(24)} v${outcome.version}${outcome.merged ? ok('  merged — a second source agrees') : ''}\n     ${dim(event.text.slice(0, 76))}`)
    else console.log(`   ${dim('·')} ${label} ${dim(`skipped: ${outcome.reason}`)}\n     ${dim(event.text.slice(0, 60))}`)
    await wait(900)
  }

  // The punchline: two apps, one claim.
  console.log(`\n${bold('3 · Claude Code states the same convention Slack did')}`)
  const agent = await fetch(`${base}/event`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ connector: 'claude-code', sourceName: 'Claude Code', sourceKind: 'agent', text: 'We use pnpm, not npm — the workspace is a pnpm monorepo', actor: 'claude-code', trigger: 'knowledge_propose over MCP', context: 'engine/core', ref: 'pnpm-workspace.yaml' }),
  }).then((r) => r.json() as Promise<{ outcome: { namespace?: string; version?: number; merged?: boolean } }>)
  console.log(`   ${ok('→')} ${agent.outcome.namespace} v${agent.outcome.version}${agent.outcome.merged ? ok('  merged — one claim, two sources, higher confidence') : ''}`)

  console.log(`\n${bold('What just happened')}`)
  console.log(`  ${dim('· five apps wrote into four namespaces you own — none of them holds the memory')}`)
  console.log(`  ${dim('· chatter and questions were skipped, with the reason recorded')}`)
  console.log(`  ${dim('· two apps stating the same thing became one claim, not two')}`)
  console.log(values.publish
    ? `  ${dim('· each namespace published to Sepolia, signed with your key, on its own cadence')}`
    : `  ${dim('· nothing was published: no key given. --publish lets it sign, or run knowledge push yourself.')}`)
  console.log(`\n  see it:    ${bold('http://localhost:3000/connect')}   ${dim('(RECALL_CACHE_DIR=' + CACHE + ' pnpm dev)')}`)
  console.log(`  inspect:   ${bold(`RECALL_CACHE_DIR=${CACHE} node engine/cli/dist/knowledge.mjs namespaces`)}\n`)
  service.kill()
}

main().catch((e: unknown) => { console.error(e); service.kill(); process.exit(1) })
