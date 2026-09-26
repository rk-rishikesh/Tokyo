/**
 * Prove a wallet, prove the name, and sign in.
 *
 * This is the entry point: the wallet *is* the identity here, and the ENS name
 * it proves *is* the namespace. There is no account to create first and no
 * host-issued subdomain to upgrade from, because a namespace this site handed
 * out would be one this site could take back — which is the thing the product
 * argues against.
 *
 * Both checks matter. The signature proves control of a wallet; only the
 * registry proves that wallet owns the name. A signature alone would let
 * anyone claim any namespace by signing a message that mentions it.
 */
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { rememberName, SESSION, SESSION_COOKIE, signSession, upsertWalletUser, verifyNameControl } from '@knowledge01/connect'

export async function POST(req: Request) {
  const jar = await cookies()
  const nonce = jar.get('wallet_nonce')?.value
  if (!nonce) return NextResponse.json({ error: 'this request expired — try again' }, { status: 400 })

  const { address, name, signature, message } = (await req.json()) as Record<string, string | undefined>
  if (!address || !name || !signature || !message) {
    return NextResponse.json({ error: 'address, name, signature and message are required' }, { status: 400 })
  }

  const result = await verifyNameControl({ address, name, signature, message, expectedNonce: nonce })
  // Single-use either way: a failed attempt must not leave a nonce behind for a
  // second try with a different name.
  jar.delete('wallet_nonce')
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 400 })

  try {
    // Worth checking for anyone next time — still verified against the registry
    // before it is offered.
    rememberName(result.name)
    const user = upsertWalletUser({ address: result.address, name: result.name })
    jar.set(SESSION_COOKIE, signSession(user.id, { address: result.address, name: result.name }), {
      httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: SESSION.days * 86400,
    })
    return NextResponse.json({ ok: true, namespace: user.namespace, address: result.address })
  } catch (e) {
    // Proven, but not signed in. Say why: an empty 500 read in the browser as
    // "sign again", and the person signed again, forever.
    return NextResponse.json({ error: `signed in, but could not start the session: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 })
  }
}
