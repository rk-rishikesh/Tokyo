/**
 * Server-side chain reads for the console.
 *
 * Everything here goes through `@knowledge01/core`, so the console never assembles
 * its own contract calls and inherits the vendored-ABI guarantee.
 */
import { createPublicClient, http, type PublicClient } from 'viem'
import { sepolia } from 'viem/chains'

export const RPC =
  process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'

export function serverClient(): PublicClient {
  return createPublicClient({ chain: sepolia, transport: http(RPC) }) as PublicClient
}

/** Collections the console lists on its directory page. */
export const KNOWN_COLLECTIONS = (process.env.NEXT_PUBLIC_RECALL_COLLECTIONS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

export const explorerTx = (hash: string) => `https://sepolia.etherscan.io/tx/${hash}`
export const explorerAddress = (addr: string) => `https://sepolia.etherscan.io/address/${addr}`

/**
 * ENS's own explorer for v2 names on Sepolia: the name, its registry (with
 * its subnames) and its resolver. It reads the deployment the official
 * Universal Resolver points at — the one our namespaces are registered on.
 */
export const ensExplorer = (name: string, page?: 'registry' | 'resolver') => `https://explorer.ens.dev/${encodeURIComponent(name)}${page ? `/${page}` : ''}`

/** Which ENS deployment the names live on. ENS resets Sepolia from time to time; say which one. */
export const ENS_DEPLOYMENT = { label: 'ENS v2 on Sepolia', since: '15 September 2026' } as const

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

export function formatExpiry(expiry: bigint): {
  label: string
  active: boolean
  days: number
} {
  const now = BigInt(Math.floor(Date.now() / 1000))
  const active = expiry > now
  const days = active ? Number((expiry - now) / 86400n) : 0
  return {
    active,
    days,
    label: expiry === 0n
      ? 'not subscribed'
      : active
        ? `${days} day${days === 1 ? '' : 's'} left`
        : 'lapsed',
  }
}

/** `<amount>:<termSeconds>` as stored in `text: recall.price`. */
export function parsePrice(raw: string): { amount: bigint; term: number } | null {
  const [amount, term] = raw.split(':')
  if (!amount || !term) return null
  try {
    return { amount: BigInt(amount), term: Number(term) }
  } catch {
    return null
  }
}

export function formatTerm(seconds: number): string {
  const days = Math.round(seconds / 86400)
  if (days % 365 === 0) return `${days / 365} year${days === 365 ? '' : 's'}`
  if (days % 30 === 0) return `${days / 30} month${days === 30 ? '' : 's'}`
  return `${days} days`
}
