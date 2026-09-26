/**
 * Client ids this deployment registered with a provider.
 *
 * Only Granola needs this. It supports dynamic client registration, which is
 * what lets a deployment that cannot publish a reachable metadata document — a
 * laptop, a private network — still introduce itself. The issued id is kept
 * beside the repositories rather than in the environment: it is given by the
 * provider, not chosen by the operator, and re-registering on every restart
 * would leave a trail of dead clients on their side.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { APP_NAME, callbackUrl, ENDPOINTS } from './endpoints.js'
import type { Provider } from './users.js'
import { cacheRoot } from './cacheRoot.js'

/** Where the issued ids are kept. */
const registrationsPath = (): string => {
  const root = cacheRoot()
  return join(root, 'oauth-clients.json')
}

type Registration = { clientId: string; clientSecret?: string; redirectUri: string; registeredAt: string }

const readRegistrations = (): Record<string, Registration> => {
  try { return JSON.parse(readFileSync(registrationsPath(), 'utf8')) as Record<string, Registration> } catch { return {} }
}

/** A client id this deployment registered earlier, if the redirect still matches. */
export function cachedRegistration(p: Provider, env: NodeJS.ProcessEnv = process.env): Registration | null {
  const hit = readRegistrations()[p]
  // A changed base URL invalidates it: the provider only accepts redirects it
  // was told about at registration.
  if (!hit || hit.redirectUri !== callbackUrl(p, env)) return null
  return hit
}

/**
 * Register this deployment with a provider that allows it.
 *
 * Granola's authorization server advertises a `registration_endpoint` and no
 * approval step, so a deployment that cannot publish a reachable metadata
 * document can still introduce itself — which is what makes localhost work.
 */
export async function registerClient(p: Provider, env: NodeJS.ProcessEnv = process.env): Promise<Registration> {
  const existing = cachedRegistration(p, env)
  if (existing) return existing
  const redirectUri = callbackUrl(p, env)
  const url = ENDPOINTS[p].registerUrl
  if (!url) throw new Error(`${p} does not support dynamic registration — set ${p.toUpperCase()}_CLIENT_ID`)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: APP_NAME,
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      application_type: 'web',
    }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`granola registration failed: ${res.status} ${(await res.text()).slice(0, 200)}`)
  const j = (await res.json()) as { client_id?: string; client_secret?: string }
  if (!j.client_id) throw new Error('granola registration returned no client_id')

  const reg: Registration = {
    clientId: j.client_id,
    ...(j.client_secret ? { clientSecret: j.client_secret } : {}),
    redirectUri,
    registeredAt: new Date().toISOString(),
  }
  const all = readRegistrations()
  all[p] = reg
  const file = registrationsPath()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(all, null, 2), { mode: 0o600 })
  return reg
}

