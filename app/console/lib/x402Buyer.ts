/**
 * Agent B, as a buyer: it pays Agent A for memory it would otherwise have to
 * produce itself.
 *
 * One key is its identity twice over: the wallet that pays over x402, and the
 * public key the namespace's content key is sealed to. So whoever paid is,
 * verifiably, whoever can read.
 *
 * It buys at most once per epoch. Before paying it checks for a grant it
 * already holds; after paying it reads the namespace from the network with its
 * own key, like any independent reader.
 */
import { privateKeyToAccount } from 'viem/accounts'
import type { Hex } from 'viem'
import { normalisePrivateKey } from '@knowledge01/core'
import { AccessDenied, grantFor, resolveNamespace, type ResolvedNamespace } from '@knowledge01/repo'
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from '@x402/fetch'
import { ExactEvmScheme } from '@x402/evm/exact/client'
import { forgetManifest, manifestOf, network, X402_NETWORK } from './x402'

export const AGENT_B = 'agent-b.portfolio'
/** Agent B will not pay more than this for one grant, whatever an offer asks. */
const MAX_PRICE_USD = 0.05

export type Purchase = { namespace: string; amount: string; asset: string; network: string; tx: string | null; payer: string; validUntil: string; at: string }
export type PaidRead = { namespace: string; claims: ResolvedNamespace['claims']; version: number; validUntil: string | null; purchase: Purchase | null; price: string | null }

function key(): Hex {
  const pk = normalisePrivateKey(process.env.AGENT_B_PRIVATE_KEY)
  if (!pk) throw new Error('Agent B has no wallet (set AGENT_B_PRIVATE_KEY)')
  return pk as Hex
}
export const agentBAddress = (): string | null => { try { return privateKeyToAccount(key()).address } catch { return null } }

const reads = new Map<string, { at: number; r: PaidRead }>()

/** Where Agent B stands with a paid namespace, without paying. */
export async function standing(namespace: string): Promise<{ price: string | null; network: string | null; payTo: string | null; epochDays: number | null; holds: boolean; validUntil: string | null; buyer: string | null }> {
  const m = await manifestOf(namespace)
  const offer = m?.offers?.find((o) => o.role === 'read') ?? null
  let grant = null
  try { grant = grantFor(m, { privateKey: key() }) } catch { /* no wallet */ }
  const live = !!grant && (!grant.validUntil || Date.parse(grant.validUntil) > Date.now())
  return { price: offer?.price ?? null, network: offer?.network ?? null, payTo: offer?.payTo ?? null, epochDays: offer?.epochDays ?? null, holds: live, validUntil: live ? grant!.validUntil ?? null : null, buyer: agentBAddress() }
}

async function readWithOwnKey(namespace: string): Promise<ResolvedNamespace> {
  return resolveNamespace(network(), namespace, { privateKey: key() })
}

/**
 * Read a paid namespace, buying access first if Agent B holds no live grant.
 * With `buy: false` it only reads what it already has access to.
 */
export async function readPaid(namespace: string, opts: { buy?: boolean } = {}): Promise<PaidRead> {
  const hit = reads.get(namespace)
  // A purchase is reported once, with the answer it paid for; later reads reuse the grant.
  if (hit && Date.now() - hit.at < 5 * 60_000) return { ...hit.r, purchase: null }

  const pk = key()
  const m = await manifestOf(namespace)
  const offer = m?.offers?.find((o) => o.role === 'read') ?? null
  const grant = grantFor(m, { privateKey: pk })
  const live = !!grant && (!grant.validUntil || Date.parse(grant.validUntil) > Date.now())

  if (live) {
    try {
      const ns = await readWithOwnKey(namespace)
      const r: PaidRead = { namespace, claims: ns.claims, version: ns.version, validUntil: grant!.validUntil ?? null, purchase: null, price: offer?.price ?? null }
      reads.set(namespace, { at: Date.now(), r })
      return r
    } catch (e) {
      // Re-keyed since the grant: it is stale, and buying again renews it.
      if (!(e instanceof AccessDenied)) throw e
    }
  }
  if (!opts.buy) throw new AccessDenied(namespace, 'no-grant')
  if (!offer) throw new Error(`${namespace} sells no access`)
  const price = Number(offer.price.replace('$', ''))
  if (!(price > 0) || price > MAX_PRICE_USD) throw new Error(`${namespace} asks ${offer.price}; Agent B pays at most $${MAX_PRICE_USD}`)
  if (offer.network !== X402_NETWORK()) throw new Error(`${namespace} is paid on ${offer.network}; Agent B pays on ${X402_NETWORK()}`)

  const account = privateKeyToAccount(pk)
  const pay = wrapFetchWithPaymentFromConfig(fetch, { schemes: [{ network: offer.network as `${string}:${string}`, client: new ExactEvmScheme(account) }] })
  const res = await pay(offer.endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agent: AGENT_B, pubkey: account.publicKey }),
    signal: AbortSignal.timeout(90_000),
  })
  const body = (await res.json().catch(() => ({}))) as { grant?: { validUntil?: string }; error?: string }
  if (!res.ok) throw new Error(`buying ${namespace} failed: ${body.error ?? res.status}`)
  const receipt = res.headers.get('PAYMENT-RESPONSE') ?? res.headers.get('X-PAYMENT-RESPONSE')
  const settled = receipt ? (decodePaymentResponseHeader(receipt) as { transaction?: string; network?: string; payer?: string }) : null

  const purchase: Purchase = {
    namespace, amount: offer.price.replace('$', ''), asset: offer.asset, network: settled?.network ?? offer.network,
    tx: settled?.transaction ?? null, payer: settled?.payer ?? account.address, validUntil: body.grant?.validUntil ?? '', at: new Date().toISOString(),
  }
  forgetManifest(namespace)

  // The grant is on ENS once its transaction confirms; an RPC node may lag a block behind.
  let ns: ResolvedNamespace | null = null
  for (let i = 0; i < 5 && !ns; i++) {
    try { ns = await readWithOwnKey(namespace) } catch (e) { if (!(e instanceof AccessDenied) || i === 4) throw e; await new Promise((r) => setTimeout(r, 3000)) }
  }
  const r: PaidRead = { namespace, claims: ns!.claims, version: ns!.version, validUntil: purchase.validUntil || null, purchase, price: offer.price }
  reads.set(namespace, { at: Date.now(), r })
  return r
}
