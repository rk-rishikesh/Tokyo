/**
 * Who is looking at the page.
 *
 * Two modes, decided by whether this deployment offers OAuth at all:
 *
 *   - Hosted: a visitor signs in, their claims go under their own namespace, and
 *     only sources they can genuinely connect are offered.
 *   - Local: someone running this on their own machine, where the local sources
 *     are theirs and CONNECT_OWNER names where claims go. No sign-in needed.
 *
 * The distinction is not cosmetic. Offering a local source on a hosted site
 * would read the server's files, so `hosted` gates the source list rather than
 * just the sign-in button.
 */
import { cookies } from 'next/headers'
import { configuredProviders, connectOwner, readUser, sessionIdentity, SESSION_COOKIE, upsertWalletUser, verifySession, type User } from '@knowledge01/connect'

export type Viewer =
  | { mode: 'hosted'; user: User | null; providers: string[] }
  | { mode: 'local'; owner: string }

export async function viewer(): Promise<Viewer> {
  // Hosted when there is a public base URL to come back to. Providers no longer
  // decide this: identity is a wallet, and a deployment with no OAuth app at all
  // can still let someone connect their name and read local sources.
  const hosted = !!process.env.CONNECT_BASE_URL?.trim() && !/localhost|127\.0\.0\.1/.test(process.env.CONNECT_BASE_URL!)
  const providers = configuredProviders()
  if (!hosted && !providers.length) {
    // Someone's own machine, with nothing to sign in to.
    return { mode: 'local', owner: connectOwner() }
  }
  const jar = await cookies()
  const cookie = jar.get(SESSION_COOKIE)?.value
  const id = verifySession(cookie)
  let user = id ? readUser(id) : null
  // Serverless: this instance may never have seen the sign-in. The signed
  // session says who proved which name, so rebuild the record rather than
  // sending them back to sign again.
  if (id && !user) {
    const who = sessionIdentity(cookie)
    if (who) user = upsertWalletUser(who)
  }
  return { mode: 'hosted', user, providers }
}

/** The namespace root for whoever is looking, or null if nobody is signed in. */
export const ownerOf = (v: Viewer): string | null =>
  v.mode === 'local' ? v.owner : v.user?.namespace ?? null
