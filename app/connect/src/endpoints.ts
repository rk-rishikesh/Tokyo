/**
 * Where each provider lives, and what this deployment is called.
 *
 * Pulled out of oauth.ts, which had grown to six jobs in one file — including a
 * nested ternary over provider names that made adding one a matter of finding
 * the right branch.
 */
import type { Provider } from './users.js'

export type ProviderEndpoints = {
  name: string
  authUrl: string
  tokenUrl: string
  /** Where to ask who a token belongs to. */
  identityUrl?: string
  /** Present only for providers that allow dynamic client registration. */
  registerUrl?: string
  /** The resource a token is scoped to, for providers that require one. */
  resource?: string
}

export const ENDPOINTS: Record<Provider, ProviderEndpoints> = {
  github: {
    name: 'GitHub',
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    identityUrl: 'https://api.github.com/user',
  },
  linear: {
    name: 'Linear',
    authUrl: 'https://linear.app/oauth/authorize',
    tokenUrl: 'https://api.linear.app/oauth/token',
    identityUrl: 'https://api.linear.app/graphql',
  },
  google: {
    name: 'Google',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    identityUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
  },
  granola: {
    name: 'Granola',
    authUrl: 'https://mcp-auth.granola.ai/oauth2/authorize',
    tokenUrl: 'https://mcp-auth.granola.ai/oauth2/token',
    registerUrl: 'https://mcp-auth.granola.ai/oauth2/register',
    resource: 'https://mcp.granola.ai/mcp',
  },
}

/** What this deployment calls itself, to a provider and in its own metadata. */
export const APP_NAME = 'Knowledge Network'
export const APP_URL = 'https://github.com/knowledge-network'

export const baseUrl = (env: NodeJS.ProcessEnv = process.env): string =>
  (env.CONNECT_BASE_URL?.trim() || 'http://localhost:3000').replace(/\/$/, '')

export const callbackUrl = (p: Provider, env: NodeJS.ProcessEnv = process.env): string =>
  `${baseUrl(env)}/api/auth/${p}/callback`

/** Where this deployment publishes its own client metadata document. */
export const clientMetadataUrl = (env: NodeJS.ProcessEnv = process.env): string =>
  `${baseUrl(env)}/api/auth/client-metadata`

/**
 * Whether an authorization server could fetch this deployment.
 *
 * CIMD makes the client id a URL the *provider* fetches. On localhost it
 * cannot, and the flow fails at the authorize step with `application_not_found`
 * — a confusing error, because nothing is wrong with the request except that
 * the client describing itself is unreachable.
 */
export function isPubliclyReachable(env: NodeJS.ProcessEnv = process.env): boolean {
  const base = env.CONNECT_BASE_URL?.trim()
  if (!base) return false
  try {
    const { hostname, protocol } = new URL(base)
    if (protocol !== 'https:') return false
    return !(
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.endsWith('.local') ||
      /^(10|127)\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
    )
  } catch { return false }
}
