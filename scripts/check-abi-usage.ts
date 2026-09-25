/**
 * Rule 1 enforcement, mechanically.
 *
 * Scans the source tree for `functionName: '...'` paired with an `abi:` from
 * `abis.*`, and fails if any named function is absent from that vendored ABI.
 * A typo or a half-remembered ENSv1 name is caught here rather than as a revert
 * on Sepolia.
 *
 * Run: pnpm check:abi
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const ABI_DIR = join(ROOT, 'engine/core/abis')

/** Maps the `abis.<key>` used in source to the vendored artifact file. */
const ABI_FILES: Record<string, string> = {
  universalResolver: 'UniversalResolverV2.json',
  registry: 'UserRegistryImpl.json',
  ethRegistry: 'ETHRegistry.json',
  ethRegistrar: 'ETHRegistrar.json',
  resolver: 'PermissionedResolverImpl.json',
  verifiableFactory: 'VerifiableFactory.json',
  erc20: 'MockUSDC.json',
}

const functions = new Map<string, Set<string>>()
const events = new Map<string, Set<string>>()
for (const [key, file] of Object.entries(ABI_FILES)) {
  const artifact = JSON.parse(readFileSync(join(ABI_DIR, file), 'utf8')) as {
    abi: { type: string; name?: string }[]
  }
  const pick = (type: string) =>
    new Set(artifact.abi.filter((e) => e.type === type && e.name).map((e) => e.name!))
  functions.set(key, pick('function'))
  events.set(key, pick('event'))
}

/** Every event name defined across the vendored ABIs, for the hand-written check. */
const ALL_EVENT_NAMES = new Set<string>(
  [...events.values()].flatMap((s) => [...s]),
)

/** Directory names skipped anywhere in the tree. */
const SKIP_ANYWHERE = new Set(['node_modules', 'dist', '.next', 'out', 'cache', 'abis'])

/**
 * Paths skipped by exact location, not by name.
 *
 * `engine/contracts/lib` is Foundry's vendored dependencies. Skipping every
 * directory *named* `lib` would also skip `app/console/lib`, which is real
 * source — and silently shrinking the guard's coverage is worse than not having
 * it.
 */
const SKIP_PATHS = new Set([join(ROOT, 'engine/contracts/lib')])

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (SKIP_ANYWHERE.has(entry)) continue
    const full = join(dir, entry)
    if (SKIP_PATHS.has(full)) continue
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (['.ts', '.tsx'].includes(extname(full))) yield full
  }
}

/** Matches an `abis.<key>` reference followed by a functionName in the same call. */
const CALL = /abi:\s*abis\.(\w+)[\s\S]{0,400}?functionName:\s*['"]([\w]+)['"]/g

/** Matches a hand-written event signature passed to parseAbiItem. */
const HAND_WRITTEN_EVENT = /parseAbiItem\(\s*['"]event\s+(\w+)\s*\(([^)]*)\)/g

/** Matches an event name filtered out of decoded logs. */
const EVENT_NAME = /(?:eventName|events):\s*\[?[\s\S]{0,200}?['"](\w+)['"]/g

let failures = 0
let checkedCalls = 0
let checkedEvents = 0

for (const file of walk(ROOT)) {
  const src = readFileSync(file, 'utf8')

  for (const m of src.matchAll(CALL)) {
    const [, abiKey, fnName] = m
    const set = functions.get(abiKey!)
    checkedCalls++
    if (!set) {
      console.log(`  FAIL  ${file}: unknown ABI key "abis.${abiKey}"`)
      failures++
      continue
    }
    if (!set.has(fnName!)) {
      console.log(`  FAIL  ${file}: "${fnName}" is not in ${ABI_FILES[abiKey!]}`)
      failures++
    }
  }

  // Hand-written event signatures are how a log silently decodes to nothing:
  // `indexed` does not change topic0, so a wrong signature still *matches* and
  // then yields empty args. Drive events off the vendored ABI instead.
  for (const m of src.matchAll(HAND_WRITTEN_EVENT)) {
    const [, eventName] = m
    checkedEvents++
    if (ALL_EVENT_NAMES.has(eventName!)) {
      console.log(
        `  FAIL  ${file}: hand-written signature for "${eventName}", which exists in a ` +
          'vendored ABI. Use the ABI (parseEventLogs) so `indexed` cannot drift.',
      )
      failures++
    }
  }
}

console.log(
  failures === 0
    ? `\nrule 1 OK — ${checkedCalls} contract call(s) and ${checkedEvents} hand-written event(s) checked; ` +
        'every function present in a vendored ABI, no ABI event hand-written.\n'
    : `\n${failures} problem(s) against the vendored ABIs.\n`,
)
process.exit(failures === 0 ? 0 : 1)
