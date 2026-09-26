/**
 * Sells read access to a namespace over x402.
 *
 *   POST /api/x402/grant/signals.treasury.eth   { agent, pubkey }
 *
 * Without payment: 402, with the price, asset, network and pay-to address
 * taken from the namespace's own offer in its access manifest. With payment:
 * the namespace's key is sealed to `pubkey`, the grant is published to the
 * manifest with the payment on it, and the buyer reads the namespace from the
 * network with its own key until the epoch ends.
 *
 * Payment settles *before* the grant is sealed (`paymentFlow: 'upfront'`). The
 * default flow settles after the handler, which would put a sealed key on ENS
 * before the money moved: if settlement then failed, the buyer would already
 * hold the key until the next re-key. Upfront, the worse case is the reverse —
 * paid, and the grant failed to publish — so the handler retries once and, if
 * it still fails, says plainly that payment went through and by whom.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withX402, x402ResourceServer } from '@x402/next'
import { HTTPFacilitatorClient } from '@x402/core/server'
import { decodePaymentSignatureHeader } from '@x402/core/http'
import { ExactEvmScheme } from '@x402/evm/exact/server'
import { epochEnd, sealGrant } from '@knowledge01/repo'
import { contentKeyFromOwnerGrant, FACILITATOR_URL, forgetManifest, network, offerOf, X402_NETWORK } from '@/lib/x402'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ROUTE = '/api/x402/grant/[ns]'
const nsOf = (path: string) => decodeURIComponent(path.split('/').filter(Boolean).at(-1) ?? '')

const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: FACILITATOR_URL() })).register(X402_NETWORK(), new ExactEvmScheme())

async function issue(req: NextRequest): Promise<NextResponse> {
  const namespace = nsOf(req.nextUrl.pathname)
  const offer = await offerOf(namespace)
  if (!offer) return NextResponse.json({ error: `${namespace} sells no access` }, { status: 404 })
  const body = (await req.json().catch(() => ({}))) as { agent?: unknown; pubkey?: unknown }
  const pubkey = typeof body.pubkey === 'string' && /^0x0[234][0-9a-fA-F]{64}$|^0x04[0-9a-fA-F]{128}$/.test(body.pubkey) ? (body.pubkey as `0x${string}`) : null
  if (!pubkey) return NextResponse.json({ error: 'send the public key to seal the grant to' }, { status: 400 })
  const agent = typeof body.agent === 'string' && body.agent.trim() ? body.agent.trim().slice(0, 64) : 'anonymous agent'

  // The payment the facilitator has verified: who paid, and how much.
  const header = req.headers.get('PAYMENT-SIGNATURE') ?? req.headers.get('X-PAYMENT')
  let payer = 'unknown', amount = offer.price.replace('$', '')
  try {
    const p = decodePaymentSignatureHeader(header ?? '') as { payload?: { authorization?: { from?: string; value?: string } } }
    payer = p.payload?.authorization?.from ?? payer
    if (p.payload?.authorization?.value) amount = (Number(p.payload.authorization.value) / 1e6).toString()
  } catch { /* the receipt is best-effort; the payment itself was verified by the facilitator */ }

  const seal = async () => {
    const contentKey = await contentKeyFromOwnerGrant(namespace)
    const validUntil = epochEnd(offer.epochDays)
    const { grant, receipt, manifest } = await sealGrant(network(true), namespace, { readers: 'key', contentKey }, {
      agent, pubkey, role: 'read', validUntil,
      payment: { scheme: 'x402', network: offer.network, asset: offer.asset, amount, payer },
    })
    forgetManifest(namespace)
    return NextResponse.json({ namespace, grant: { id: grant.id, agent, validUntil }, keyVersion: manifest.keyVersion, manifestTx: receipt })
  }
  try { return await seal() } catch { /* one retry: a manifest write can lose a race with another grant */ }
  try { return await seal() } catch (e) {
    // Settled already (upfront): be exact about what happened so it can be made good.
    console.error(`[x402] ${namespace}: paid by ${payer} (${amount}), grant for ${pubkey.slice(0, 12)}… not published`, e)
    return NextResponse.json({ error: `payment from ${payer} settled, but the grant could not be published: ${e instanceof Error ? e.message : 'unknown error'}. Do not pay again; give the namespace owner this payer address to have the grant issued.`, paid: true, payer }, { status: 502 })
  }
}

const paid = withX402(issue, {
  [ROUTE]: {
    accepts: {
      scheme: 'exact',
      network: X402_NETWORK(),
      price: async (ctx) => (await offerOf(nsOf(ctx.path)))?.price ?? '$0.01',
      payTo: async (ctx) => (await offerOf(nsOf(ctx.path)))?.payTo ?? (process.env.X402_PAY_TO ?? ''),
      // Settle before sealing: never publish a key for money that has not moved.
      extra: { paymentFlow: 'upfront' },
    },
    description: 'Read access to a knowledge namespace until the end of its epoch, sealed to your key',
  },
}, server)

export async function POST(req: NextRequest) {
  // An unknown or free namespace is a 404, not a price.
  if (!(await offerOf(nsOf(req.nextUrl.pathname)))) return NextResponse.json({ error: 'this namespace sells no access' }, { status: 404 })
  return paid(req)
}

/** The terms, for anyone who asks before paying. */
export async function GET(req: NextRequest) {
  const offer = await offerOf(nsOf(req.nextUrl.pathname))
  return offer ? NextResponse.json({ offer, epochEnds: epochEnd(offer.epochDays) }) : NextResponse.json({ error: 'this namespace sells no access' }, { status: 404 })
}
