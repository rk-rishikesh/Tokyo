/**
 * Who a token belongs to, asked of the provider rather than trusted from the
 * client.
 *
 * Each of these was an inline branch in `whoami`, including a Linear GraphQL
 * call that duplicated the transport in linear.ts — two clients for one API,
 * either of which could be changed without the other.
 */
import { ENDPOINTS } from './endpoints.js'
import type { Provider } from './users.js'

export type Identity = { providerId: string; login: string; avatar?: string }

const TIMEOUT = 15_000

async function githubIdentity(token: string): Promise<Identity> {
  const r = await fetch(ENDPOINTS.github.identityUrl!, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'knowledge-connect' },
    signal: AbortSignal.timeout(TIMEOUT),
  })
  if (!r.ok) throw new Error(`github identity: ${r.status}`)
  const u = (await r.json()) as { id: number; login: string; avatar_url?: string }
  return { providerId: String(u.id), login: u.login, ...(u.avatar_url ? { avatar: u.avatar_url } : {}) }
}

async function linearIdentity(token: string): Promise<Identity> {
  const r = await fetch(ENDPOINTS.linear.identityUrl!, {
    method: 'POST',
    // Linear takes the raw token, not a Bearer prefix.
    headers: { authorization: token, 'content-type': 'application/json' },
    body: JSON.stringify({ query: '{ viewer { id name displayName avatarUrl } }' }),
    signal: AbortSignal.timeout(TIMEOUT),
  })
  if (!r.ok) throw new Error(`linear identity: ${r.status}`)
  const j = (await r.json()) as { data?: { viewer?: { id: string; name: string; displayName?: string; avatarUrl?: string } } }
  const v = j.data?.viewer
  if (!v) throw new Error('linear identity: no viewer')
  return { providerId: v.id, login: v.displayName ?? v.name, ...(v.avatarUrl ? { avatar: v.avatarUrl } : {}) }
}

async function googleIdentity(token: string): Promise<Identity> {
  const r = await fetch(ENDPOINTS.google.identityUrl!, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TIMEOUT),
  })
  if (!r.ok) throw new Error(`google identity: ${r.status}`)
  const u = (await r.json()) as { sub: string; email?: string; name?: string; picture?: string }
  return { providerId: u.sub, login: u.email?.split('@')[0] ?? u.name ?? u.sub, ...(u.picture ? { avatar: u.picture } : {}) }
}

async function granolaIdentity(token: string): Promise<Identity> {
  // Granola identifies the account through its own MCP tool rather than a
  // userinfo endpoint, so identity comes from the same resource the token was
  // issued for.
  const { accountInfo } = await import('./granola.js')
  const a = await accountInfo(token)
  return { providerId: a.id, login: a.login }
}

const BY_PROVIDER: Record<Provider, (token: string) => Promise<Identity>> = {
  github: githubIdentity,
  linear: linearIdentity,
  google: googleIdentity,
  granola: granolaIdentity,
}

export const whoami = (p: Provider, accessToken: string): Promise<Identity> => BY_PROVIDER[p](accessToken)
