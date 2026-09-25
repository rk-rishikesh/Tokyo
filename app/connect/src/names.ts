/**
 * Which names a wallet owns.
 *
 * ENSv2 has no "list the names this address owns" call, and the public subgraph
 * indexes v1 rather than the beta registries these names live in. So discovery
 * is a lookup over candidates rather than a query: ask the registry who owns
 * each one, and keep the matches.
 *
 * That is worth stating plainly rather than hiding, because it decides what the
 * interface can promise. It cannot say "here is everything you own". It can say
 * "here is what we found", offer to check a name the person names, and let them
 * register one if nothing matches — which is the honest version of the same
 * screen.
 */
import { createPublicClient, http, type Address, type PublicClient } from 'viem'
import { sepolia } from 'viem/chains'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { reposDir } from '@recall/repo'
import { findExpiry, findOwner, findParentRegistry } from '@recall/core/resolve'

export type OwnedName = {
  name: string
  /** When the registration lapses, if the registry reports one. */
  expiresAt?: string
}

export const client = (): PublicClient =>
  createPublicClient({
    chain: sepolia,
    transport: http(process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'),
  }) as PublicClient

/**
 * Names worth checking for any wallet.
 *
 * Anything this deployment already knows about — namespaces on disk, names in
 * the environment — reduced to their registrable root. A name someone else owns
 * costs one call to rule out, and finding one the visitor owns saves them
 * typing it.
 */
export function candidateNames(extra: string[] = [], env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = (env.NEXT_PUBLIC_KNOWLEDGE_NAMESPACES ?? '').split(',')
  // Names anyone has already proved here, and namespaces on disk. Without this
  // a name registered through this app would not appear in the list the next
  // time its owner signed in — the one place it is certain to be theirs.
  const roots = [...configured, ...extra, ...seenNames(), env.CONNECT_OWNER ?? '']
    .map((n) => n.trim().toLowerCase())
    .filter(Boolean)
    // `tools.recalltest.eth` is owned through `recalltest.eth`; only the root is
    // registrable, and only the root is worth asking about.
    .map((n) => n.split('.').slice(-2).join('.'))
    .filter((n) => n.endsWith('.eth') && n.split('.').length === 2)
  return [...new Set(roots)]
}

/** Whether this address owns this name, according to the registry. */
export async function ownsName(address: string, name: string): Promise<boolean> {
  try {
    const owner = await findOwner(client(), name)
    return owner.toLowerCase() === address.toLowerCase()
  } catch {
    return false
  }
}

/**
 * The names from `candidates` that this wallet owns.
 *
 * Checked in parallel, and a name that cannot be resolved is simply not owned —
 * an unregistered name and a broken RPC look the same from here, and treating
 * either as ownership would be worse than missing one.
 */
export async function namesOwnedBy(address: string, candidates: string[]): Promise<OwnedName[]> {
  const c = client()
  const results = await Promise.all(
    candidates.map(async (name): Promise<OwnedName | null> => {
      try {
        const owner = await findOwner(c, name)
        if (owner.toLowerCase() !== address.toLowerCase()) return null
        const expiresAt = await expiryOf(c, name)
        return { name, ...(expiresAt ? { expiresAt } : {}) }
      } catch {
        return null
      }
    }),
  )
  return results.filter((r): r is OwnedName => !!r)
}

async function expiryOf(c: PublicClient, name: string): Promise<string | undefined> {
  try {
    const label = name.split('.')[0]!
    const registry = await findParentRegistry(c, name)
    const expiry = await findExpiry(c, registry as Address, label)
    return expiry > 0n ? new Date(Number(expiry) * 1000).toISOString() : undefined
  } catch {
    return undefined
  }
}

export type NameStatus = 'owned' | 'taken' | 'available' | 'unknown'

/**
 * What a person can do with a name they typed.
 *
 * Three answers matter and they are different actions: they own it and can
 * continue, someone else owns it and they cannot, or nobody does and they can
 * register it.
 */
export async function statusOf(address: string, name: string): Promise<{ status: NameStatus; owner?: string }> {
  const clean = name.trim().toLowerCase()
  if (!/^[a-z0-9-]+\.eth$/.test(clean)) return { status: 'unknown' }
  try {
    const owner = await findOwner(client(), clean)
    if (owner === '0x0000000000000000000000000000000000000000') return { status: 'available' }
    return owner.toLowerCase() === address.toLowerCase()
      ? { status: 'owned', owner }
      : { status: 'taken', owner }
  } catch {
    // A name that does not resolve is one nobody has registered.
    return { status: 'available' }
  }
}


// ---------------------------------------------------------------------------
// Names this deployment has seen
// ---------------------------------------------------------------------------

/**
 * Registrable roots worth checking, learned rather than configured.
 *
 * Two sources: names someone has proved here, and namespaces already on disk.
 * Neither is an assertion of ownership — every one is still checked against the
 * registry before it is offered.
 */
export function seenNames(): string[] {
  const out = new Set<string>(rememberedNames())
  try {
    const dir = reposDir()
    if (existsSync(dir)) {
      for (const ns of readdirSync(dir)) out.add(ns.split('.').slice(-2).join('.'))
    }
  } catch { /* no repositories yet */ }
  try {
    const dir = join(cacheRoot(), 'users')
    if (existsSync(dir)) {
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.json') || f.endsWith('.grants.json') || f.endsWith('.activity.json')) continue
        const u = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { namespace?: string; wallet?: { name?: string } }
        for (const n of [u.namespace, u.wallet?.name]) {
          if (n) out.add(n.split('.').slice(-2).join('.'))
        }
      }
    }
  } catch { /* no users yet */ }
  return [...out].filter((n) => n.endsWith('.eth') && n.split('.').length === 2)
}

/**
 * Remember a name so it appears in the list next time.
 *
 * Learning from repositories and users only works once someone has signed in,
 * which is exactly not the moment that matters: a name registered through this
 * app is the one name we can be certain belongs to whoever just registered it,
 * and it was the one name the list could not show them.
 *
 * This is a list of names to *check*, never a claim of ownership — every one is
 * still asked of the registry before it is offered to anybody.
 */
export function rememberName(name: string): void {
  const root = name.trim().toLowerCase().split('.').slice(-2).join('.')
  if (!/^[a-z0-9-]+\.eth$/.test(root)) return
  try {
    const file = join(cacheRoot(), 'known-names.json')
    const existing = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as string[]) : []
    if (existing.includes(root)) return
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify([...existing, root], null, 2), { mode: 0o600 })
  } catch { /* a name we fail to remember is one the Check box still finds */ }
}

function rememberedNames(): string[] {
  try {
    const file = join(cacheRoot(), 'known-names.json')
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as string[]) : []
  } catch { return [] }
}

function cacheRoot(): string {
  const base = process.env.RECALL_CACHE_DIR ?? '~/.recall'
  return base.startsWith('~') ? join(homedir(), base.slice(1)) : resolve(base)
}
