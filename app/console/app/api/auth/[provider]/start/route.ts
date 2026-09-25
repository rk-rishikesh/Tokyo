/**
 * Begin an OAuth flow.
 *
 * The `state` value is stored in an httpOnly cookie and checked on the way back:
 * without it, anyone could hand a visitor a crafted callback URL and attach
 * their own provider account to that visitor's session.
 */
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { authorizeUrl, isPubliclyReachable, newState, newVerifier, providerConfig, registerClient, SESSION_COOKIE, verifySession, type Provider } from '@recall/connect'

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params
  const p = provider as Provider
  if (!['github', 'google', 'linear', 'granola'].includes(p)) {
    return NextResponse.json({ error: `${provider} is not a provider this app knows` }, { status: 404 })
  }
  // Granola needs no credentials, but on a host it cannot reach it has to be
  // told who we are first. Registering here rather than at startup keeps it to
  // the moment someone actually asks to connect.
  if (!providerConfig(p)) {
    if (p !== 'granola' || isPubliclyReachable()) {
      return NextResponse.json({ error: `${provider} is not configured on this deployment` }, { status: 404 })
    }
    try { await registerClient('granola') } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'registration failed' }, { status: 502 })
    }
  }
  // Connecting a source attaches it to someone who already exists, so there is
  // nothing to attach it to without a wallet. Refusing here rather than in the
  // callback saves a pointless trip to the provider and an authorisation the
  // person would have granted for nothing.
  const jar = await cookies()
  if (!verifySession(jar.get(SESSION_COOKIE)?.value)) {
    return NextResponse.redirect(new URL('/app?error=connect+your+wallet+first', new URL(req.url).origin))
  }

  const state = newState()
  const cookieOpts = { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 600 }
  jar.set(`oauth_state_${p}`, state, cookieOpts)

  // A public client proves it is the party that started the flow by keeping the
  // verifier and sending only its hash up front. It must never reach the
  // provider or the page, so it lives in an httpOnly cookie until the exchange.
  const cfg = providerConfig(p)!
  const verifier = cfg.publicClient ? newVerifier() : undefined
  if (verifier) jar.set(`oauth_verifier_${p}`, verifier, cookieOpts)

  return NextResponse.redirect(authorizeUrl(p, state, process.env, verifier))
}
