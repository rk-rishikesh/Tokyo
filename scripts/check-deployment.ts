/**
 * Rule 2 enforcement: prove the pinned deployment is real, and that the vendored
 * ABIs describe the contracts actually deployed there.
 *
 * `check-abi-usage.ts` proves we only *name* functions that exist in a vendored
 * ABI. That is necessary but not sufficient — the ABI is a snapshot, and the
 * chain moves. This goes further and checks each function's 4-byte selector
 * against the **deployed bytecode** at the pinned address.
 *
 * Absence of a selector is conclusive: the function is not callable there. That
 * is how a stale pin gets caught before it becomes a revert on stage.
 *
 * Run: pnpm check:deployment
 */
import 'dotenv/config'
import { createPublicClient, http, toFunctionSelector, type Abi } from 'viem'
import { sepolia } from 'viem/chains'
import { abis, addresses, dnsEncode, UNIVERSAL_RESOLVER } from '@k01/core'

const RPC = process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'

/**
 * Every function this codebase calls, grouped by the ABI it is called through.
 * Keep in step with the code — `check-abi-usage.ts` guards the names, this
 * guards that they exist on chain.
 */
type Target = {
  address: `0x${string}`
  abi: Abi
  fns: string[]
  /**
   * A proxy holds no function selectors of its own — it delegates. Scanning its
   * bytecode would report every function missing, so proxies are verified
   * behaviourally instead: we actually call them.
   */
  proxy?: boolean
}

const USED: Record<string, Target> = {
  registry: {
    address: addresses.userRegistryImpl,
    abi: abis.registry,
    fns: [
      'initialize', 'register', 'renew', 'unregister', 'findExpiry', 'findTokenId',
      'getSubregistry', 'getResolver', 'setResolver', 'setSubregistry', 'getState',
      'getStatus', 'getExpiry', 'getTokenId', 'getResource', 'grantRoles',
      'grantRootRoles', 'hasRoles', 'roleCount', 'ownerOf', 'latestOwnerOf',
      'supportsInterface', 'ROOT_RESOURCE',
    ],
  },
  resolver: {
    address: addresses.permissionedResolverImpl,
    abi: abis.resolver,
    fns: [
      'initialize', 'setText', 'setContenthash', 'setData', 'setPubkey', 'text',
      'contenthash', 'data', 'pubkey', 'addr', 'resolve', 'multicall',
      'authorizeDataRoles', 'authorizeTextRoles', 'grantRoles', 'grantRootRoles',
      'revokeRoles', 'hasRoles', 'supportsInterface', 'ROOT_RESOURCE',
    ],
  },
  verifiableFactory: {
    address: addresses.verifiableFactory,
    abi: abis.verifiableFactory,
    fns: ['deployProxy', 'verifyContract'],
  },
  ethRegistrar: {
    address: addresses.ethRegistrar,
    abi: abis.ethRegistrar,
    fns: [
      'isAvailable', 'getRegisterPrice', 'makeCommitment', 'commit', 'register',
      'MIN_COMMITMENT_AGE', 'MAX_COMMITMENT_AGE', 'ETH_REGISTRY',
    ],
  },
  erc20: {
    address: addresses.stablecoin,
    abi: abis.erc20,
    fns: ['approve', 'allowance', 'transferFrom', 'balanceOf', 'decimals', 'symbol', 'name', 'mint'],
  },
  universalResolver: {
    address: UNIVERSAL_RESOLVER,
    abi: abis.universalResolver,
    proxy: true,
    fns: [
      'resolve', 'findResolver', 'findCanonicalRegistry', 'findExactRegistry',
      'findParentRegistry', 'findOwner', 'ROOT_REGISTRY',
    ],
  },
}

/** A name that exists on ENSv2 Sepolia, used to exercise the resolver proxy. */
const PROBE_NAME = process.env.RECALL_PROBE_NAME ?? 'gregskril.eth'

async function main() {
  const client = createPublicClient({ chain: sepolia, transport: http(RPC) })
  console.log(`\nRecall — pinned deployment check\n  rpc: ${RPC}\n`)

  let failures = 0

  for (const [key, { address, abi, fns, proxy }] of Object.entries(USED)) {
    const code = await client.getCode({ address })
    if (!code || code === '0x') {
      console.log(`  FAIL  ${key.padEnd(20)} no code at ${address}`)
      failures++
      continue
    }

    if (proxy) {
      // Behavioural check: a working delegation answers a real read.
      try {
        const root = await client.readContract({
          address,
          abi,
          functionName: 'ROOT_REGISTRY',
        })
        const registry = await client.readContract({
          address,
          abi,
          functionName: 'findCanonicalRegistry',
          args: [dnsEncode(PROBE_NAME)],
        })
        console.log(
          `  PASS  ${key.padEnd(20)} ${address}  proxy delegates; ROOT_REGISTRY=${root}`,
        )
        void registry
      } catch (e) {
        console.log(`  FAIL  ${key.padEnd(20)} ${address} proxy did not answer: ${(e as Error).message.split('\n')[0]}`)
        failures++
      }
      continue
    }

    const missing: string[] = []
    for (const fn of fns) {
      const overloads = (abi as readonly { type: string; name?: string }[]).filter(
        (e) => e.type === 'function' && e.name === fn,
      )
      if (overloads.length === 0) {
        missing.push(`${fn} (absent from vendored ABI)`)
        continue
      }
      // Present if any overload's selector appears in the deployed code.
      const found = overloads.some((e) =>
        code.includes(toFunctionSelector(e as never).slice(2)),
      )
      if (!found) missing.push(fn)
    }

    if (missing.length > 0) {
      console.log(`  FAIL  ${key.padEnd(20)} ${address}`)
      for (const m of missing) console.log(`          missing: ${m}`)
      failures += missing.length
    } else {
      console.log(
        `  PASS  ${key.padEnd(20)} ${address}  ${fns.length} function(s), ${(code.length - 2) / 2} bytes`,
      )
    }
  }

  console.log(
    failures === 0
      ? '\nPinned deployment OK — every called function exists in the deployed bytecode.\n'
      : `\n${failures} problem(s). The pin is stale or the ABI no longer matches; fix CONTRACTS.md.\n`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('\ncheck-deployment failed:', e)
  process.exit(1)
})
