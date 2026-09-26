/**
 * x402 in the console: selling grants to paid namespaces, and Agent B buying them.
 *
 * A namespace's price lives in its access manifest (an `offer`), published on
 * ENS next to its grants, so a buyer finds it by resolving the name. Paying
 * the offer's endpoint returns a grant: the namespace's key sealed to the
 * buyer's own public key, with the payment recorded on it. From then on the
 * buyer reads the namespace from the network with its own key, until the end
 * of the offer's epoch.
 *
 * Payments settle in USDC through an x402 facilitator (Base Sepolia by
 * default). Grants are published on Sepolia ENS. The two are separate chains
 * on purpose: the grant is not a payment, it is a record of one.
 */
import { createWalletClient, http, type Hex, type WalletClient } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import { normalisePrivateKey, unwrapKey } from '@knowledge01/core'
import { ensNetwork, OWNER_KEY_MESSAGE, ownerKeyFromSignature, readManifest, type AccessManifest, type Network } from '@knowledge01/repo'
import { createStorage } from '@knowledge01/storage'
import { RPC, serverClient } from './chain'

export const X402_NETWORK = () => (process.env.X402_NETWORK?.trim() || 'eip155:84532') as `${string}:${string}`
export const FACILITATOR_URL = () => process.env.X402_FACILITATOR_URL?.trim() || 'https://x402.org/facilitator'
export const NETWORK_NAME: Record<string, string> = { 'eip155:84532': 'Base Sepolia', 'eip155:8453': 'Base' }
export const txUrl = (network: string, tx: string) => `${network === 'eip155:8453' ? 'https://basescan.org' : 'https://sepolia.basescan.org'}/tx/${tx}`

/** The owner's wallet on Sepolia: it writes the name's records, so it issues grants. */
function ownerWallet(): WalletClient | null {
  const pk = normalisePrivateKey(process.env.PRIVATE_KEY)
  return pk ? (createWalletClient({ account: privateKeyToAccount(pk), chain: sepolia, transport: http(RPC) }) as WalletClient) : null
}

/** Read-only unless `write`: grants are written with the owner's wallet. */
export function network(write = false): Network {
  const wallet = write ? ownerWallet() : null
  if (write && !wallet) throw new Error('issuing grants needs PRIVATE_KEY, the wallet that owns the name')
  return ensNetwork({ storage: createStorage(), client: serverClient(), ...(wallet ? { wallet } : {}) })
}

// Manifests change on every grant; a short cache spares ENS a read per request.
const manifests = new Map<string, { at: number; m: AccessManifest | null }>()
export async function manifestOf(namespace: string, fresh = false): Promise<AccessManifest | null> {
  const hit = manifests.get(namespace)
  if (!fresh && hit && Date.now() - hit.at < 30_000) return hit.m
  const m = await readManifest(network(), namespace)
  manifests.set(namespace, { at: Date.now(), m })
  return m
}
export const forgetManifest = (namespace: string) => manifests.delete(namespace)

export async function offerOf(namespace: string) {
  const m = await manifestOf(namespace)
  return m?.offers?.find((o) => o.role === 'read') ?? null
}

/**
 * The namespace's current content key, unsealed from the owner's own grant.
 * Re-derived on every call rather than stored, so it follows each re-key: the
 * seller never holds a key the owner has since rotated away.
 */
export async function contentKeyFromOwnerGrant(namespace: string): Promise<Uint8Array> {
  const wallet = ownerWallet()
  if (!wallet?.account) throw new Error('unsealing the key needs PRIVATE_KEY, the wallet that owns the name')
  const m = await manifestOf(namespace, true)
  const owner = m?.grants.find((g) => g.owner && g.wrappedKey)
  if (!owner?.wrappedKey) throw new Error(`${namespace} has no owner grant to unseal its key from`)
  const sig = await wallet.signMessage({ account: wallet.account, message: OWNER_KEY_MESSAGE(namespace) })
  return unwrapKey(owner.wrappedKey as Hex, ownerKeyFromSignature(sig).privateKey)
}
