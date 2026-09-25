/**
 * The network: where a namespace can be found by anyone, without asking us.
 *
 * Two things live there. Bytes, in content-addressed storage. And a namespace's
 * records — the `contenthash` that says which version is current, and text
 * records such as `knowledge.access` that say who may read it. In production
 * the bytes are IPFS and the records are an ENSv2 resolver; locally both are a
 * directory that neither application owns.
 *
 * The interface is the point. An agent that reads a namespace depends on this
 * and on nothing else: not on the app that wrote it, not on its database, not
 * on its API. That is what makes "delete the company" a test that can pass.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { abis, findResolver, getContenthash, getText } from '@recall/core'
import { FileAdapter, MemoryAdapter, type StorageAdapter } from '@recall/storage'
import { namehash, type Hex, type PublicClient, type WalletClient } from 'viem'
import { EnsPointer } from './ens.js'
import type { Pointer } from './remote.js'

/** The text record holding a namespace's access manifest. */
export const ACCESS_RECORD = 'knowledge.access'

/** A namespace's on-network records: the current version, and text records. */
export interface Records extends Pointer {
  readText(key: string): Promise<string | null>
  writeText(key: string, value: string): Promise<string>
}

export interface Network {
  /** What this network is, for the interface to say plainly. */
  readonly kind: 'memory' | 'local' | 'sepolia'
  readonly storage: StorageAdapter
  records(namespace: string): Records
}

// ---------------------------------------------------------------------------
// In memory — for tests
// ---------------------------------------------------------------------------

export function memoryNetwork(): Network {
  const storage = new MemoryAdapter()
  const contenthashes = new Map<string, Hex>()
  const texts = new Map<string, string>()
  let tx = 0
  return {
    kind: 'memory',
    storage,
    records(namespace) {
      return {
        read: async () => contenthashes.get(namespace) ?? null,
        write: async (ch) => { contenthashes.set(namespace, ch); return `memory-tx-${++tx}` },
        readText: async (key) => texts.get(`${namespace}\u0000${key}`) ?? null,
        writeText: async (key, value) => { texts.set(`${namespace}\u0000${key}`, value); return `memory-tx-${++tx}` },
      }
    },
  }
}

// ---------------------------------------------------------------------------
// A directory — the local stand-in for IPFS and ENS
// ---------------------------------------------------------------------------

/**
 * Where the local network lives.
 *
 * Deliberately outside `~/.recall`, which is the demo app's own state. Resetting
 * the app — deleting its database, its users, its OAuth tokens — leaves this
 * untouched, the way deleting a company leaves IPFS and ENS untouched.
 */
export function localNetworkDir(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.KNOWLEDGE_NETWORK_DIR?.trim() || '~/.knowledge-network'
  return base.startsWith('~') ? join(homedir(), base.slice(1)) : resolve(base)
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback
  try { return JSON.parse(readFileSync(path, 'utf8')) as T } catch { return fallback }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2))
  renameSync(tmp, path)
}

/**
 * `storage` overrides where bytes go. The app passes real IPFS here, so what it
 * stages locally is only the records — the part that needs the owner's wallet
 * to reach the chain — while the bytes are already where any reader can fetch
 * them.
 */
export function localNetwork(dir: string = localNetworkDir(), opts: { storage?: StorageAdapter } = {}): Network {
  const storage = opts.storage ?? new FileAdapter(join(dir, 'ipfs'))
  // One file per namespace plays the part of its resolver: a contenthash and a
  // map of text records, exactly the fields an ENSv2 PermissionedResolver holds.
  const recordPath = (namespace: string) => join(dir, 'ens', `${namespace}.json`)
  type Resolver = { contenthash?: Hex; text: Record<string, string>; writes: number }
  const load = (ns: string) => readJson<Resolver>(recordPath(ns), { text: {}, writes: 0 })
  const save = (ns: string, r: Resolver) => writeJson(recordPath(ns), r)

  return {
    kind: 'local',
    storage,
    records(namespace) {
      return {
        read: async () => load(namespace).contenthash ?? null,
        write: async (ch) => {
          const r = load(namespace)
          r.contenthash = ch
          r.writes++
          save(namespace, r)
          return `local-tx-${namespace}-${r.writes}`
        },
        readText: async (key) => load(namespace).text[key] ?? null,
        writeText: async (key, value) => {
          const r = load(namespace)
          r.text[key] = value
          r.writes++
          save(namespace, r)
          return `local-tx-${namespace}-${r.writes}`
        },
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Sepolia — ENSv2 records and a real IPFS adapter
// ---------------------------------------------------------------------------

/** ENSv2 records: reads through the Universal Resolver, writes to the name's resolver. */
class EnsRecords extends EnsPointer implements Records {
  constructor(
    private readonly name: string,
    private readonly client: PublicClient,
    private readonly signer?: WalletClient,
  ) {
    super(name, client, signer)
  }

  async readText(key: string): Promise<string | null> {
    try {
      const v = await getText(this.client, this.name, key)
      return v || null
    } catch {
      return null
    }
  }

  async writeText(key: string, value: string): Promise<string> {
    if (!this.signer?.account) throw new Error('writing a text record needs a wallet')
    const { resolver } = await findResolver(this.client, this.name)
    if (BigInt(resolver) === 0n) throw new Error(`${this.name} has no resolver on chain`)
    const hash = await this.signer.writeContract({
      account: this.signer.account,
      chain: this.signer.chain,
      address: resolver,
      abi: abis.resolver,
      functionName: 'setText',
      args: [namehash(this.name), key, value],
    } as never)
    const receipt = await this.client.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') throw new Error(`setText reverted (${hash})`)
    return hash
  }
}

export function ensNetwork(opts: { storage: StorageAdapter; client: PublicClient; wallet?: WalletClient }): Network {
  return {
    kind: 'sepolia',
    storage: opts.storage,
    records: (namespace) => new EnsRecords(namespace, opts.client, opts.wallet),
  }
}

/** Kept for callers that want a contenthash without a Records object. */
export const readContenthash = (client: PublicClient, name: string) => getContenthash(client, name)
