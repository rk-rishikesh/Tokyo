/**
 * Move namespaces to the ENS v2 deployment the official Universal Resolver
 * points at, keeping what they published.
 *
 * ENS resets its Sepolia v2 deployment from time to time; a reset leaves names
 * in the old registries, invisible to every app that reads through the vanity
 * proxy. This re-registers each name on the current deployment (pinned in
 * engine/core/abis) and copies its records across as they were: the
 * `contenthash` (the published version) and `knowledge.access` (the access
 * manifest — offers and sealed grants). Neither depends on the chain, so
 * nothing is re-encrypted or re-pinned; the IPFS objects are the same.
 *
 *   node --conditions=development --import tsx scripts/migrate-namespaces.ts \
 *     --from 0x4A18…3C70 [--key-env PRIVATE_KEY] [--min-eth 0.0012] name.eth child.name.eth …
 *
 * Parents must come before their children. Idempotent: a name already ours is
 * not registered again, and a record already equal is not rewritten.
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { createPublicClient, createWalletClient, decodeAbiParameters, encodeFunctionData, formatEther, http, namehash, parseEther, type Abi, type Address, type Hex, type PublicClient, type WalletClient } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import { abis, ACCESS_TEXT_KEY, dnsEncode, findResolver, getContenthash, getText, normalisePrivateKey } from '@knowledge01/core'
import { registerNamespace } from '../engine/cli/src/register.js'

const { values: v, positionals: names } = parseArgs({ allowPositionals: true, options: { from: { type: 'string' }, 'from-abi': { type: 'string' }, 'key-env': { type: 'string', default: 'PRIVATE_KEY' }, 'min-eth': { type: 'string', default: '0.0012' } } })
if (!v.from || !names.length) throw new Error('usage: migrate-namespaces --from <old UR address> [--from-abi old-UR.json] name.eth …')

const RPC = process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'
const pk = normalisePrivateKey(process.env[v['key-env']!])
if (!pk) throw new Error(`${v['key-env']} is not set`)
const account = privateKeyToAccount(pk)
const client = createPublicClient({ chain: sepolia, transport: http(RPC) }) as PublicClient
const wallet = createWalletClient({ account, chain: sepolia, transport: http(RPC) }) as WalletClient
// The old deployment's Universal Resolver, read with the ABI it was deployed with.
const oldAbi: Abi = v['from-abi'] ? (JSON.parse(readFileSync(v['from-abi'], 'utf8')) as { abi: Abi }).abi : abis.universalResolver
const OLD = v.from as Address

async function oldRecord(name: string, data: Hex, type: 'bytes' | 'string'): Promise<string> {
  const res = await client.readContract({ address: OLD, abi: oldAbi, functionName: 'resolve', args: [dnsEncode(name), data] } as never).catch(() => null) as [Hex] | null
  if (!res || res[0].length <= 2) return type === 'bytes' ? '0x' : ''
  return decodeAbiParameters([{ type }], res[0])[0] as string
}

const log = (s: string) => process.stdout.write(s + '\n')
for (const name of names) {
  const balance = await client.getBalance({ address: account.address })
  if (balance < parseEther(v['min-eth']!)) { log(`■ stopping before ${name}: ${formatEther(balance)} ETH left (needs ${v['min-eth']})`); break }
  log(`\n▸ ${name}  (${formatEther(balance)} ETH)`)
  const was = {
    contenthash: await oldRecord(name, encodeFunctionData({ abi: abis.resolver, functionName: 'contenthash', args: [namehash(name)] }), 'bytes') as Hex,
    access: await oldRecord(name, encodeFunctionData({ abi: abis.resolver, functionName: 'text', args: [namehash(name), ACCESS_TEXT_KEY] }), 'string'),
  }
  const r = await registerNamespace(name, client, wallet, (m) => log('  ' + m))
  const { resolver } = await findResolver(client, name)
  if (BigInt(resolver) === 0n) throw new Error(`${name} registered but resolves to no resolver`)

  const calls: Hex[] = []
  const now = { contenthash: await getContenthash(client, name).catch(() => '0x' as Hex), access: await getText(client, name, ACCESS_TEXT_KEY).catch(() => '') }
  if (was.contenthash !== '0x' && now.contenthash !== was.contenthash) calls.push(encodeFunctionData({ abi: abis.resolver, functionName: 'setContenthash', args: [namehash(name), was.contenthash] }))
  if (was.access && now.access !== was.access) calls.push(encodeFunctionData({ abi: abis.resolver, functionName: 'setText', args: [namehash(name), ACCESS_TEXT_KEY, was.access] }))
  if (calls.length) {
    const hash = await wallet.writeContract({ account, chain: sepolia, address: resolver, abi: abis.resolver, functionName: 'multicall', args: [calls] } as never)
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 180_000 })
    if (receipt.status !== 'success') throw new Error(`copying records for ${name} reverted (${hash})`)
    log(`  ✓ copied ${[was.contenthash !== '0x' ? 'contenthash' : '', was.access ? 'access manifest' : ''].filter(Boolean).join(' + ')} · ${hash.slice(0, 12)}…`)
  } else log(`  · ${was.contenthash === '0x' && !was.access ? 'nothing published on the old deployment' : 'records already match'}`)
  log(`  ✓ ${name} → resolver ${resolver}${r.alreadyRegistered ? ' (already registered)' : ''}`)
}
