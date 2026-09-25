/**
 * Pre-deployment check.
 *
 * `deploy-collection.ts` sends roughly ten transactions in sequence, and several are
 * not reversible — once a name is registered and proxies are deployed, re-running
 * creates a second set rather than repairing the first. So everything that can be
 * checked without spending gas is checked here.
 *
 * The deploy script repeats the two checks that would otherwise strand contracts
 * (name ownership and `ROLE_SET_SUBREGISTRY`) before it sends anything. The rest
 * — funding, storage credentials, contract code — is only checked here, so run
 * this first.
 *
 * Run: pnpm preflight --publisher auditor.eth --collection exploits
 */
import 'dotenv/config'
import { parseArgs } from 'node:util'
import {
  createPublicClient,
  formatEther,
  http,
  type Address,
  type PublicClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import {
  abis,
  addresses,
  combineRoles,
  getEthRegistry,
  keccakLabel,
  RegistryRoles,
  normalisePrivateKey,
  SEPOLIA_CHAIN_ID,
} from '@knowledge01/core'

const { values } = parseArgs({
  options: {
    publisher: { type: 'string' },
    collection: { type: 'string' },
    storage: { type: 'string', default: process.env.RECALL_STORAGE ?? 'pinata' },
  },
})

const RPC = process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'

/** Enough for ~10 transactions with headroom. */
const MIN_BALANCE_WEI = 20_000_000_000_000_000n // 0.02 ETH

let failures = 0
let warnings = 0
const pass = (l: string, d = '') => console.log(`  PASS  ${l.padEnd(34)} ${d}`)
const fail = (l: string, d = '') => {
  failures++
  console.log(`  FAIL  ${l.padEnd(34)} ${d}`)
}
const warn = (l: string, d = '') => {
  warnings++
  console.log(`  WARN  ${l.padEnd(34)} ${d}`)
}

async function main() {
  console.log('\nRecall — pre-deployment check\n')

  // ---------------------------------------------------------------- wallet
  const pk = normalisePrivateKey(process.env.PRIVATE_KEY)
  if (!pk) {
    fail(
      'PRIVATE_KEY',
      process.env.PRIVATE_KEY
        ? 'not 32 bytes of hex — check for a truncated paste'
        : 'empty — paste a test wallet key',
    )
    console.log('\nCannot continue without a key.\n')
    process.exit(1)
  }
  const account = privateKeyToAccount(pk)
  pass('PRIVATE_KEY', `deploying as ${account.address}`)

  const client = createPublicClient({ chain: sepolia, transport: http(RPC) }) as PublicClient

  const chainId = await client.getChainId()
  chainId === SEPOLIA_CHAIN_ID
    ? pass('chain is Sepolia', String(chainId))
    : fail('chain is Sepolia', `got ${chainId}`)

  const balance = await client.getBalance({ address: account.address })
  balance >= MIN_BALANCE_WEI
    ? pass('wallet funded', `${formatEther(balance)} SepoliaETH`)
    : fail('wallet funded', `${formatEther(balance)} SepoliaETH — need ~0.02 for ten transactions`)

  // ---------------------------------------------------------------- name
  if (!values.publisher) {
    fail('--publisher', 'required, e.g. --publisher auditor.eth')
  } else {
    const label = values.publisher.replace(/\.eth$/, '')
    const ethRegistry = await getEthRegistry(client)
    pass('.eth registry discovered', ethRegistry)

    const expiry = (await client.readContract({
      address: ethRegistry,
      abi: abis.ethRegistry,
      functionName: 'findExpiry',
      args: [label],
    })) as bigint

    const now = BigInt(Math.floor(Date.now() / 1000))
    if (expiry === 0n) {
      fail(`${values.publisher} registered`, 'not registered — register it on Sepolia first')
    } else if (expiry <= now) {
      fail(`${values.publisher} registered`, `expired at ${new Date(Number(expiry) * 1000).toISOString()}`)
    } else {
      pass(`${values.publisher} registered`, `expires ${new Date(Number(expiry) * 1000).toISOString()}`)

      const owner = (await client.readContract({
        address: ethRegistry,
        abi: abis.ethRegistry,
        functionName: 'getOwner',
        args: [BigInt(keccakLabel(label))],
      })) as Address

      owner.toLowerCase() === account.address.toLowerCase()
        ? pass('name owned by this wallet', owner)
        : fail('name owned by this wallet', `owned by ${owner}`)

      // The real gate: step 1 of the deploy points the name at a new subregistry.
      const canSetSubregistry = (await client.readContract({
        address: ethRegistry,
        abi: abis.ethRegistry,
        functionName: 'hasRoles',
        args: [
          BigInt(keccakLabel(label)),
          combineRoles(RegistryRoles.SET_SUBREGISTRY),
          account.address,
        ],
      })) as boolean

      canSetSubregistry
        ? pass('can set its subregistry', 'ROLE_SET_SUBREGISTRY held')
        : fail(
            'can set its subregistry',
            'missing ROLE_SET_SUBREGISTRY — deploy would revert at step 1',
          )
    }
  }

  // ---------------------------------------------------------------- contracts
  for (const [label, address] of [
    ['verifiable factory', addresses.verifiableFactory],
    ['user registry impl', addresses.userRegistryImpl],
    ['resolver impl', addresses.permissionedResolverImpl],
    ['stablecoin', addresses.stablecoin],
  ] as const) {
    const code = await client.getCode({ address })
    code && code !== '0x' ? pass(`pinned: ${label}`, address) : fail(`pinned: ${label}`, 'no code')
  }

  // ---------------------------------------------------------------- storage
  if (values.storage === 'pinata') {
    const jwt = process.env.PINATA_JWT ?? ''
    const gateway = process.env.PINATA_GATEWAY ?? ''
    if (!jwt) {
      fail('PINATA_JWT', 'empty — the collection content cannot be stored')
    } else {
      // `testAuthentication` only proves the key is valid, not that it may pin.
      // A key with no scopes passes it and then fails at the last step of the
      // deploy, after every contract has been paid for. So actually pin
      // something: it is the only honest test of the permission we need.
      try {
        const form = new FormData()
        form.append('file', new Blob([new Uint8Array([0x72, 0x65, 0x63])]), 'recall-preflight')
        form.append('pinataMetadata', JSON.stringify({ name: 'recall-preflight' }))
        const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
          method: 'POST',
          headers: { Authorization: `Bearer ${jwt}` },
          body: form,
        })
        if (res.ok) {
          const { IpfsHash } = (await res.json()) as { IpfsHash?: string }
          pass('Pinata can pin', IpfsHash ?? 'ok')
          // Tidy up; failure to unpin is not a blocker.
          if (IpfsHash) {
            await fetch(`https://api.pinata.cloud/pinning/unpin/${IpfsHash}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${jwt}` },
            }).catch(() => undefined)
          }
        } else {
          const body = await res.text()
          fail(
            'Pinata can pin',
            body.includes('NO_SCOPES_FOUND')
              ? 'key has no scopes — create a key with pinFileToIPFS (or Admin) permission'
              : `${res.status} ${body.slice(0, 120)}`,
          )
        }
      } catch (e) {
        fail('Pinata can pin', (e as Error).message)
      }
    }
    gateway
      ? pass('PINATA_GATEWAY', gateway)
      : warn('PINATA_GATEWAY', 'empty — reads fall back to no gateway and will be slow or fail')
  } else if (values.storage === 'swarm') {
    warn('storage = swarm', 'the Swarm path has never been exercised; pinata is the tested path')
  }

  // ---------------------------------------------------------------- simulate
  // Only the first call can be simulated: everything after it depends on an
  // address that does not exist yet. Still worth doing — it is the step most
  // likely to be misconfigured.
  if (failures === 0) {
    try {
      await client.simulateContract({
        account,
        address: addresses.verifiableFactory,
        abi: abis.verifiableFactory,
        functionName: 'deployProxy',
        args: [addresses.userRegistryImpl, BigInt(Date.now()), '0x'],
      })
      pass('factory accepts a deployProxy', 'simulated, not sent')
    } catch (e) {
      warn('factory accepts a deployProxy', (e as Error).message.split('\n')[0] ?? '')
    }
  }

  console.log(
    failures === 0
      ? `\nReady to deploy${warnings ? ` (${warnings} warning(s))` : ''}.\n` +
          `  pnpm deploy:collection --collection ${values.collection ?? '<label>'} --publisher ${values.publisher ?? '<name>.eth'} --seed seed.json\n`
      : `\n${failures} blocker(s). Fix these before deploying — a partial deploy leaves ` +
          'contracts and a registered name behind that the script will not reuse.\n',
  )
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('\npreflight failed:', e)
  process.exit(1)
})
