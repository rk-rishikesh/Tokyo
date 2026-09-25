/**
 * M0 gate: prove the ENSv2 foundation is real before anything is built on it.
 *
 * Checks, in order:
 *   1. the RPC is Sepolia
 *   2. the Universal Resolver proxy has code
 *   3. root and `.eth` registries can be discovered through it
 *   4. the vendored ABIs match the live contracts (interface IDs)
 *   5. a real name's `text` record resolves through the Universal Resolver
 *
 * Run: pnpm resolve:check
 */
import 'dotenv/config'
import { createPublicClient, http, type PublicClient } from 'viem'
import { sepolia } from 'viem/chains'
import {
  abis,
  addresses,
  INTERFACE_IDS,
  SEPOLIA_CHAIN_ID,
  UNIVERSAL_RESOLVER,
} from '@recall/core'
import {
  findResolver,
  getEthRegistry,
  getRootRegistry,
  getText,
} from '@recall/core'

const RPC = process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'

/** A name known to carry a text record on ENSv2 Sepolia. */
const PROBE_NAME = process.env.RECALL_PROBE_NAME ?? 'gregskril.eth'
const PROBE_KEY = process.env.RECALL_PROBE_KEY ?? 'avatar'

let failures = 0
const ok = (label: string, detail: string) => console.log(`  PASS  ${label.padEnd(34)} ${detail}`)
const bad = (label: string, detail: string) => {
  failures++
  console.log(`  FAIL  ${label.padEnd(34)} ${detail}`)
}

async function main() {
  console.log(`\nRecall M0 check — ENSv2 on Sepolia\n  rpc: ${RPC}\n`)

  const client = createPublicClient({
    chain: sepolia,
    transport: http(RPC),
  }) as PublicClient

  const chainId = await client.getChainId()
  chainId === SEPOLIA_CHAIN_ID
    ? ok('chain is Sepolia', String(chainId))
    : bad('chain is Sepolia', `got ${chainId}, want ${SEPOLIA_CHAIN_ID}`)

  const urCode = await client.getCode({ address: UNIVERSAL_RESOLVER })
  urCode && urCode !== '0x'
    ? ok('universal resolver has code', `${UNIVERSAL_RESOLVER} (${(urCode.length - 2) / 2} bytes)`)
    : bad('universal resolver has code', `no code at ${UNIVERSAL_RESOLVER}`)

  const root = await getRootRegistry(client)
  const eth = await getEthRegistry(client)
  BigInt(root) !== 0n
    ? ok('root registry discovered', root)
    : bad('root registry discovered', 'zero address')
  BigInt(eth) !== 0n
    ? ok('.eth registry discovered', eth)
    : bad('.eth registry discovered', 'zero address')

  // The vendored registry ABI must describe the live registry, not a snapshot.
  const isRegistry = await client.readContract({
    address: eth,
    abi: abis.ethRegistry,
    functionName: 'supportsInterface',
    args: [INTERFACE_IDS.IPermissionedRegistry],
  })
  isRegistry
    ? ok('live .eth registry matches ABI', `supportsInterface(IPermissionedRegistry) = true`)
    : bad('live .eth registry matches ABI', 'interface not supported')

  for (const [label, address] of [
    ['verifiable factory', addresses.verifiableFactory],
    ['user registry impl', addresses.userRegistryImpl],
    ['resolver impl', addresses.permissionedResolverImpl],
    ['stablecoin', addresses.stablecoin],
  ] as const) {
    const code = await client.getCode({ address })
    code && code !== '0x'
      ? ok(`pinned: ${label}`, address)
      : bad(`pinned: ${label}`, `no code at ${address}`)
  }

  // The actual M0 requirement.
  const { resolver } = await findResolver(client, PROBE_NAME)
  const value = await getText(client, PROBE_NAME, PROBE_KEY)
  value
    ? ok('text record resolves', `${PROBE_NAME} ${PROBE_KEY} = "${value}" (via ${resolver})`)
    : bad('text record resolves', `${PROBE_NAME} has no "${PROBE_KEY}" text record`)

  console.log(
    failures === 0
      ? '\nM0 foundation OK.\n'
      : `\n${failures} check(s) failed — fix CONTRACTS.md before building on this.\n`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('\ncheck-resolve failed:', e)
  process.exit(1)
})
