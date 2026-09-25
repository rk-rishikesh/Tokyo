/**
 * The OAuth flow itself: scopes, PKCE, the authorize URL and the token
 * exchange.
 *
 * Written against the endpoints directly rather than an SDK: the whole flow is
 * two redirects and one POST, and the parts worth getting right — state
 * validation, tokens never reaching the browser, refresh handling — are exactly
 * the parts an SDK hides.
 *
 * Scopes are the narrowest that answer the question the agent asks. GitHub gets
 * `read:user` and public repository metadata, not `repo`. Google gets the
 * *readonly* Calendar and Gmail *metadata* scopes, because the agent wants to
 * know which meetings recur and which services mail you — never the contents of
 * a message.
 *
 * Where each provider lives is in endpoints.ts; who a token belongs to is in
 * identity.ts; dynamically registered client ids are in registrations.ts. This
 * file had all four jobs and a nested ternary over provider names, which made
 * adding a provider a matter of finding the right branch.
 */
import { createHash, randomBytes } from 'node:crypto'
import { callbackUrl, clientMetadataUrl, ENDPOINTS, isPubliclyReachable } from './endpoints.js'
import { cachedRegistration } from './registrations.js'
import { TAKEOUT_SCOPES } from './takeout.js'
import type { Provider } from './users.js'

export { callbackUrl, clientMetadataUrl, isPubliclyReachable } from './endpoints.js'
export { cachedRegistration, registerClient } from './registrations.js'
export { whoami, type Identity } from './identity.js'

export type ProviderConfig = {
  id: Provider
  name: string
  authUrl: string
  tokenUrl: string
  scopes: string[]
  clientId: string
  /** Empty for a public client, which authenticates with PKCE instead. */
  clientSecret: string
  /**
   * A public client identified by a URL rather than a registered secret.
   *
   * Granola's authorization server advertises
   * `client_id_metadata_document_supported` and accepts
   * `token_endpoint_auth_method: none`, so the client id *is* a URL this app
   * hosts describing itself. There is no developer signup and no secret to
   * keep — proof of possession comes from PKCE instead.
   */
  publicClient?: boolean
  /** The resource a token is scoped to, for providers that require one. */
  resource?: string
}

export const SCOPES: Record<Provider, string[]> = {
  // `read:user` for identity, `public_repo` for repository metadata. A private
  // repository still counts toward a language claim and is never named, so the
  // broad `repo` scope — which would grant read access to private source — is
  // deliberately not requested.
  github: ['read:user', 'public_repo'],
  // Linear's `read` is its only read scope — there is no narrower one. What
  // keeps this honest is the reader: issue titles are never stored, only which
  // teams and projects someone works in and how much. See linear.ts.
  linear: ['read'],
  // `openid profile` identifies the person; `offline_access` is what keeps the
  // connection alive past the first hour. The notes themselves come through the
  // MCP resource, whose own scope is `mcp`.
  granola: ['openid', 'profile', 'offline_access', 'mcp'],
  google: [
    'openid',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/calendar.readonly',
    // Metadata only: headers, never bodies. This is the difference between
    // "which services you use" and reading someone's mail.
    'https://www.googleapis.com/auth/gmail.metadata',
    // Data Portability. The only sanctioned route to what someone orders and
    // watches — food delivery, e-commerce and YouTube history are otherwise
    // closed to third parties entirely, and the YouTube Data API has refused to
    // return watch history since 2016.
    //
    // Deliberately narrow: Chrome history, autofill and Search activity are all
    // available under this same API and none of them is requested.
    ...TAKEOUT_SCOPES,
  ],
}

export function providerConfig(p: Provider, env: NodeJS.ProcessEnv = process.env): ProviderConfig | null {
  const e = ENDPOINTS[p]
  const base = { id: p, name: e.name, authUrl: e.authUrl, tokenUrl: e.tokenUrl, scopes: SCOPES[p] }

  // Granola needs no registration at all when this deployment is reachable: the
  // client id is the URL of its own metadata document. Anything else —
  // localhost, a private network — uses a client id registered earlier, because
  // the provider cannot fetch a document it cannot reach.
  if (p === 'granola') {
    const registered = isPubliclyReachable(env) ? null : cachedRegistration('granola', env)
    if (!isPubliclyReachable(env) && !registered) return null
    return {
      ...base,
      publicClient: true,
      clientId: registered?.clientId ?? clientMetadataUrl(env),
      clientSecret: '',
      ...(e.resource ? { resource: e.resource } : {}),
    }
  }

  const clientId = env[`${p.toUpperCase()}_CLIENT_ID`]?.trim()
  const clientSecret = env[`${p.toUpperCase()}_CLIENT_SECRET`]?.trim()
  if (!clientId || !clientSecret) return null
  return { ...base, clientId, clientSecret }
}

/**
 * Providers this deployment can offer.
 *
 * Granola counts even before it has a client id: registration is automatic and
 * happens the moment someone clicks Connect, so hiding the row until then would
 * hide a source that works.
 */
export const configuredProviders = (env: NodeJS.ProcessEnv = process.env): Provider[] =>
  (Object.keys(ENDPOINTS) as Provider[]).filter((p) => (p === 'granola' ? true : !!providerConfig(p, env)))

/** A one-time value tying the redirect back to the browser that started it. */
export const newState = (): string => randomBytes(16).toString('hex')

/**
 * PKCE: a secret the client keeps, and the hash it shows up front.
 *
 * A public client has no secret to prove it is itself, so it proves it instead
 * by being the same party that started the flow — it sends the hash when asking
 * for a code and the original when redeeming it. An intercepted code is then
 * useless to anyone else.
 */
export const newVerifier = (): string => randomBytes(32).toString('base64url')
export const challengeFor = (verifier: string): string =>
  createHash('sha256').update(verifier).digest('base64url')

export function authorizeUrl(p: Provider, state: string, env: NodeJS.ProcessEnv = process.env, verifier?: string): string {
  const cfg = providerConfig(p, env)
  if (!cfg) throw new Error(`${p} is not configured on this deployment`)
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: callbackUrl(p, env),
    scope: cfg.scopes.join(' '),
    state,
    response_type: 'code',
  })
  if (cfg.publicClient) {
    if (!verifier) throw new Error(`${p} is a public client and requires a PKCE verifier`)
    params.set('code_challenge', challengeFor(verifier))
    params.set('code_challenge_method', 'S256')
    if (cfg.resource) params.set('resource', cfg.resource)
  }
  // Google only issues a refresh token when it is asked to, and only the first
  // time unless prompted — without this a returning user's access silently dies
  // after an hour.
  if (p === 'google') {
    params.set('access_type', 'offline')
    params.set('prompt', 'consent')
  }
  return `${cfg.authUrl}?${params}`
}

export type TokenResponse = { accessToken: string; refreshToken?: string; expiresIn?: number; scopes: string[] }

type TokenJson = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

async function postToken(cfg: ProviderConfig, body: URLSearchParams, what: string): Promise<TokenResponse> {
  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15_000),
  })
  const json = (await res.json()) as TokenJson
  if (!res.ok || json.error || !json.access_token) {
    throw new Error(`${cfg.id} ${what} failed: ${json.error_description ?? json.error ?? res.status}`)
  }
  return {
    accessToken: json.access_token,
    ...(json.refresh_token ? { refreshToken: json.refresh_token } : {}),
    ...(json.expires_in ? { expiresIn: json.expires_in } : {}),
    scopes: (json.scope ?? '').split(/[ ,]/).filter(Boolean),
  }
}

export async function exchangeCode(p: Provider, code: string, env: NodeJS.ProcessEnv = process.env, verifier?: string): Promise<TokenResponse> {
  const cfg = providerConfig(p, env)
  if (!cfg) throw new Error(`${p} is not configured on this deployment`)
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    code,
    redirect_uri: callbackUrl(p, env),
    grant_type: 'authorization_code',
  })
  if (cfg.publicClient) {
    if (!verifier) throw new Error(`${p} is a public client and requires a PKCE verifier`)
    body.set('code_verifier', verifier)
    if (cfg.resource) body.set('resource', cfg.resource)
  } else {
    body.set('client_secret', cfg.clientSecret)
  }
  return postToken(cfg, body, 'token exchange')
}

/**
 * Trade a refresh token for a fresh access token.
 *
 * This existed for weeks with no caller, which is why every connection worked
 * on the day it was made and then went quiet. `tokens.ts` calls it now, ahead
 * of expiry rather than after a 401.
 */
export async function refreshAccessToken(p: Provider, refreshToken: string, env: NodeJS.ProcessEnv = process.env): Promise<TokenResponse> {
  const cfg = providerConfig(p, env)
  if (!cfg) throw new Error(`${p} is not configured on this deployment`)
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    ...(cfg.publicClient ? {} : { client_secret: cfg.clientSecret }),
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })
  if (cfg.publicClient && cfg.resource) body.set('resource', cfg.resource)
  return postToken(cfg, body, 'refresh')
}
