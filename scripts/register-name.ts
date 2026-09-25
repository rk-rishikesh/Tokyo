/**
 * Buy a `.eth` second-level name on Sepolia — the publisher name a collection hangs under.
 *
 * ENSv2 registration is commit-reveal, which exists to stop someone watching the
 * mempool and front-running your name: you publish a hash first, wait, then
 * reveal. So this is necessarily a multi-transaction, multi-minute operation.
 *
 * Payment is in a test stablecoin rather than ETH. MockUSDC is freely mintable on
 * Sepolia, so the script tops the wallet up rather than making you find a faucet.
 *
 * Run: pnpm register:name --label recall
 */
import 'dotenv/config'
import { parseArgs } from 'node:util'
import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  getAddress,
  http,
  toHex,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import { randomBytes } from 'node:crypto'
import {
  abis,
  addresses,
  combineRoles,
  getEthRegistry,
  keccakLabel,
  normalisePrivateKey,
  RegistryRoles,
  STABLECOIN_DECIMALS,
} from '@k01/core'

const { values } = parseArgs({
  options: {
    label: { type: 'string' },
    years: { type: 'string', default: '1' },
  },
})

if (!values.label) {
  console.error('usage: pnpm register:name --label <name>   (without the .eth)')
  process.exit(1)
}
const LABEL = values.label
const DURATION = BigInt(Math.round(Number(values.years) * 31_536_000))

const RPC = process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'
const PRIVATE_KEY = normalisePrivateKey(process.env.PRIVATE_KEY)
if (!PRIVATE_KEY) {
  console.error('PRIVATE_KEY is required (32 bytes of hex, with or without 0x).')
  process.exit(1)
}

const account = privateKeyToAccount(PRIVATE_KEY)
const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC) }) as PublicClient
const wallet = createWalletClient({ account, chain: sepolia, transport: http(RPC) }) as WalletClient

const step = (n: number, m: string) => console.log(`\n[${n}] ${m}`)
const info = (m: string) => console.log(`    ${m}`)

async function send(label: string, request: Record<string, unknown>): Promise<Hex> {
  const hash = await wallet.writeContract(request as never)
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`${label} reverted (${hash})`)
  info(`${label} ✓ ${hash}`)
  return hash
}

async function main() {
  console.log(`\nRegistering ${LABEL}.eth on Sepolia`)
  console.log(`  wallet:   ${account.address}`)
  console.log(`  duration: ${values.years} year(s)`)

  const registrar = addresses.ethRegistrar

  // ---------------------------------------------------------------- 1
  step(1, 'Checking availability and price')
  const available = (await publicClient.readContract({
    address: registrar,
    abi: abis.ethRegistrar,
    functionName: 'isAvailable',
    args: [LABEL],
  })) as boolean
  if (!available) throw new Error(`${LABEL}.eth is not available.`)
  info('available ✓')

  const [base, premium] = (await publicClient.readContract({
    address: registrar,
    abi: abis.ethRegistrar,
    functionName: 'getRegisterPrice',
    args: [LABEL, DURATION, addresses.stablecoin],
  })) as [bigint, bigint]
  const price = base + premium
  info(`price: ${formatUnits(price, STABLECOIN_DECIMALS)} USDC`)

  // ---------------------------------------------------------------- 2
  step(2, 'Ensuring the wallet holds enough test USDC')
  let balance = (await publicClient.readContract({
    address: addresses.stablecoin,
    abi: abis.erc20,
    functionName: 'balanceOf',
    args: [account.address],
  })) as bigint
  info(`balance: ${formatUnits(balance, STABLECOIN_DECIMALS)} USDC`)

  if (balance < price) {
    // Mint comfortably more than the name costs: the same token pays for
    // subscriptions later, and a second faucet trip mid-demo is avoidable.
    const topUp = price * 100n
    info(`minting ${formatUnits(topUp, STABLECOIN_DECIMALS)} USDC`)
    await send('mint', {
      account,
      chain: sepolia,
      address: addresses.stablecoin,
      abi: abis.erc20,
      functionName: 'mint',
      args: [account.address, topUp],
    })
    balance += topUp
  }

  // ---------------------------------------------------------------- 3
  step(3, 'Approving the registrar')
  const allowance = (await publicClient.readContract({
    address: addresses.stablecoin,
    abi: abis.erc20,
    functionName: 'allowance',
    args: [account.address, registrar],
  })) as bigint
  if (allowance < price) {
    await send('approve', {
      account,
      chain: sepolia,
      address: addresses.stablecoin,
      abi: abis.erc20,
      functionName: 'approve',
      args: [registrar, balance],
    })
  } else {
    info('already approved ✓')
  }

  // ---------------------------------------------------------------- 4
  // The name is registered with no subregistry and no resolver — deploy-collection.ts
  // creates and attaches both. Registering them here would mean deploying
  // contracts before knowing the name was actually won.
  const secret = toHex(randomBytes(32)) as Hex
  const commitmentArgs = [
    LABEL,
    account.address,
    secret,
    zeroAddress,
    zeroAddress,
    DURATION,
    zeroHash,
  ] as const

  step(4, 'Committing')
  const commitment = (await publicClient.readContract({
    address: registrar,
    abi: abis.ethRegistrar,
    functionName: 'makeCommitment',
    args: commitmentArgs,
  })) as Hex
  info(`commitment: ${commitment}`)
  await send('commit', {
    account,
    chain: sepolia,
    address: registrar,
    abi: abis.ethRegistrar,
    functionName: 'commit',
    args: [commitment],
  })

  // ---------------------------------------------------------------- 5
  const minAge = (await publicClient.readContract({
    address: registrar,
    abi: abis.ethRegistrar,
    functionName: 'MIN_COMMITMENT_AGE',
  })) as bigint
  const waitMs = Number(minAge) * 1000 + 15_000
  step(5, `Waiting out the commitment age (${minAge}s + buffer)`)
  info('this delay is the front-running protection; it cannot be skipped')
  await new Promise((r) => setTimeout(r, waitMs))

  // ---------------------------------------------------------------- 6
  step(6, 'Registering')
  await send('register', {
    account,
    chain: sepolia,
    address: registrar,
    abi: abis.ethRegistrar,
    functionName: 'register',
    args: [
      LABEL,
      account.address,
      secret,
      zeroAddress,
      zeroAddress,
      DURATION,
      addresses.stablecoin,
      zeroHash,
    ],
  })

  // ---------------------------------------------------------------- 7
  step(7, 'Verifying')
  const ethRegistry = await getEthRegistry(publicClient)
  const labelhash = BigInt(keccakLabel(LABEL))

  const owner = (await publicClient.readContract({
    address: ethRegistry,
    abi: abis.ethRegistry,
    functionName: 'getOwner',
    args: [labelhash],
  })) as Address
  const expiry = (await publicClient.readContract({
    address: ethRegistry,
    abi: abis.ethRegistry,
    functionName: 'findExpiry',
    args: [LABEL],
  })) as bigint
  const canSetSubregistry = (await publicClient.readContract({
    address: ethRegistry,
    abi: abis.ethRegistry,
    functionName: 'hasRoles',
    args: [labelhash, combineRoles(RegistryRoles.SET_SUBREGISTRY), account.address],
  })) as boolean

  info(`owner:  ${owner} ${getAddress(owner) === getAddress(account.address) ? '✓' : '✗ NOT US'}`)
  info(`expiry: ${new Date(Number(expiry) * 1000).toISOString()}`)
  info(`can set subregistry: ${canSetSubregistry ? '✓' : '✗ — deploy-collection would revert'}`)

  console.log(`\nRegistered ${LABEL}.eth\n`)
  console.log('Next:')
  console.log(`  pnpm preflight --publisher ${LABEL}.eth --collection exploits\n`)
}

main().catch((e) => {
  console.error('\nregister-name failed:', e)
  process.exit(1)
})
