/**
 * Finish an OAuth flow: exchange the code, store the token encrypted, sign the
 * person in.
 *
 * The access token is written to the server-side user record and never sent to
 * the browser. The cookie carries only a signed user id.
 */
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { exchangeCode, putToken, providerConfig, readUser, SESSION_COOKIE, verifySession, whoami, type Provider } from '@k01/connect'

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params
  const p = provider as Provider
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const jar = await cookies()

  const fail = (why: string) => NextResponse.redirect(new URL(`/app?error=${encodeURIComponent(why)}`, url.origin))

  if (!['github', 'google', 'linear', 'granola'].includes(p) || !providerConfig(p)) return fail(`${provider} is not configured`)
  if (url.searchParams.get('error')) return fail(url.searchParams.get('error_description') ?? url.searchParams.get('error')!)
  if (!code) return fail('no authorization code came back')

  const expected = jar.get(`oauth_state_${p}`)?.value
  if (!expected || expected !== state) return fail('this sign-in did not start here — try again')
  jar.delete(`oauth_state_${p}`)

  const verifier = jar.get(`oauth_verifier_${p}`)?.value
  if (providerConfig(p)!.publicClient && !verifier) return fail('this sign-in expired — try again')
  jar.delete(`oauth_verifier_${p}`)

  try {
    const token = await exchangeCode(p, code, process.env, verifier)
    const who = await whoami(p, token.accessToken)

    // Connecting a second provider must attach to the session already signed in,
    // not create a second person: someone who signs in with GitHub and then
    // connects Google is one user with two tokens.
    // Connecting a provider attaches a source to someone who already exists.
    // It never creates a person: identity here is a wallet that proved an ENS
    // name, so there is no such thing as a user without one. A namespace this
    // site issued would be one this site could take back.
    const sessionId = verifySession(jar.get(SESSION_COOKIE)?.value)
    const user = sessionId ? readUser(sessionId) : null
    if (!user) return fail('connect your wallet first — that is what decides where claims are written')

    putToken(user.id, {
      provider: p,
      account: who.login,
      scopes: token.scopes,
      grantedAt: new Date().toISOString(),
      accessToken: token.accessToken,
      ...(token.refreshToken ? { refreshToken: token.refreshToken } : {}),
      ...(token.expiresIn ? { expiresAt: new Date(Date.now() + token.expiresIn * 1000).toISOString() } : {}),
    })

    return NextResponse.redirect(new URL('/app', url.origin))
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'sign-in failed')
  }
}
