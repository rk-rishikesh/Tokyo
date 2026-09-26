/**
 * Empty our names on a superseded ENS v2 deployment.
 *
 * After a reset (see migrate-namespaces.ts) the old registries still hold our
 * names and records. Nothing reads them, but a stale copy of a namespace is a
 * second answer to "what does this name say?" — so it is taken down:
 *
 *   1. clearRecords on the name's old resolver (contenthash, access manifest, text…)
 *   2. unregister it, when the parent registry is one of ours (child names)
 *   3. otherwise detach it: resolver and subregistry set to zero in the parent
 *      (a top-level .eth name cannot be unregistered by its owner — it expires)
 *
 * Deepest names first, so a parent is detached only after its children.
 *
 *   node --conditions=development --import tsx scripts/retire-old-deployment.ts \
 *     --from <old UR> --from-abi <old UR json> [--key-env PRIVATE_KEY] [--apply] name.eth …
 *
 * Without --apply it only prints what it would do.
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { createPublicClient, createWalletClient, getAddress, http, namehash, zeroAddress, type Abi, type Address, type PublicClient } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import { abis, dnsEncode, keccakLabel, normalisePrivateKey } from '@knowledge01/core'

const { values: v, positionals } = parseArgs({ allowPositionals: true, options: { from: { type: 'string' }, 'from-abi': { type: 'string' }, 'key-env': { type: 'string', default: 'PRIVATE_KEY' }, apply: { type: 'boolean', default: false } } })
if (!v.from || !v['from-abi'] || !positionals.length) throw new Error('usage: retire-old-deployment --from <old UR> --from-abi <old UR json> [--apply] name.eth …')
const RPC = process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'
const account = privateKeyToAccount(normalisePrivateKey(process.env[v['key-env']!])!)
const client = createPublicClient({ chain: sepolia, transport: http(RPC) }) as PublicClient
const wallet = createWalletClient({ account, chain: sepolia, transport: http(RPC) })
const OLD = { address: v.from as Address, abi: (JSON.parse(readFileSync(v['from-abi'], 'utf8')) as { abi: Abi }).abi }
const log = (s: string) => process.stdout.write(s + '\n')

const read = <T>(address: Address, abi: Abi, functionName: string, args: unknown[] = []) => client.readContract({ address, abi, functionName, args } as never) as Promise<T>
const root = await read<Address>(OLD.address, OLD.abi, 'ROOT_REGISTRY')

/** The old registry that holds `name`'s own label. */
async function parentRegistry(name: string): Promise<Address> {
  const labels = name.split('.').slice(1).reverse()
  let r = root
  for (const l of labels) { r = await read<Address>(r, abis.registry, 'getSubregistry', [l]); if (BigInt(r) === 0n) return zeroAddress }
  return r
}

async function send(label: string, to: Address, abi: Abi, functionName: string, args: unknown[]): Promise<boolean> {
  if (!v.apply) { log(`  would ${label}`); return true }
  try {
    await client.simulateContract({ account, address: to, abi, functionName, args } as never)
    const hash = await wallet.writeContract({ address: to, abi, functionName, args } as never)
    const r = await client.waitForTransactionReceipt({ hash, timeout: 240_000 })
    log(`  ${r.status === 'success' ? '✓' : '✗'} ${label} · ${hash.slice(0, 12)}…`)
    return r.status === 'success'
  } catch (e) { log(`  · ${label}: not allowed (${((e as { shortMessage?: string }).shortMessage ?? String(e)).split('\n')[0]})`); return false }
}

const names = [...positionals].sort((a, b) => b.split('.').length - a.split('.').length)
for (const name of names) {
  const owner = await read<Address>(OLD.address, OLD.abi, 'findOwner', [dnsEncode(name)]).catch(() => zeroAddress)
  if (BigInt(owner) === 0n) { log(`▸ ${name}: not registered on the old deployment`); continue }
  if (getAddress(owner) !== account.address) { log(`▸ ${name}: owned by ${owner}, not this wallet — skipped`); continue }
  log(`▸ ${name}`)
  const [resolver] = await read<[Address]>(OLD.address, OLD.abi, 'findResolver', [dnsEncode(name)])
  if (BigInt(resolver) !== 0n) await send(`clear records on ${resolver.slice(0, 10)}…`, resolver, abis.resolver, 'clearRecords', [namehash(name)])
  const parent = await parentRegistry(name)
  if (BigInt(parent) === 0n) { log('  · parent registry already gone'); continue }
  const id = BigInt(keccakLabel(name.split('.')[0]!))
  const isChild = name.split('.').length > 2
  if (isChild && await send('unregister in its parent registry', parent, abis.registry, 'unregister', [id])) continue
  const regAbi = isChild ? abis.registry : abis.ethRegistry
  await send('detach resolver', parent, regAbi, 'setResolver', [id, zeroAddress])
  await send('detach subregistry', parent, regAbi, 'setSubregistry', [id, zeroAddress])
}

