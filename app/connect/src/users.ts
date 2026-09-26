/**
 * Who is connected, and what they allowed.
 *
 * Everything else in this package was written for one person on one machine:
 * one grants file, one owner from the environment. A hosted site cannot work
 * that way — if two people connect, the agent must read *their* accounts and
 * write into *their* namespaces, never the machine it happens to run on.
 *
 * So identity is explicit here. A `User` is someone who signed in with a
 * provider; their namespaces hang under their own ENS name; their access tokens
 * are encrypted at rest with a key the server holds, never in a cookie and
 * never sent to the browser.
 *
 * The store is a directory of JSON files. That is enough for a single instance
 * and swaps for a real database behind this same interface — every caller goes
 * through these functions, so nothing else has to change.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { SESSION } from './policy.js'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

export type Provider = 'github' | 'google' | 'linear' | 'granola'

/** An access token the server holds on someone's behalf, encrypted at rest. */
export type StoredToken = {
  provider: Provider
  /** AES-256-GCM, as iv:tag:ciphertext in hex. Never leaves the server. */
  secret: string
  scopes: string[]
  /** What the provider calls them, for display only. */
  account: string
  grantedAt: string
  expiresAt?: string
  /** Refresh token, same encryption. Google's access tokens last an hour. */
  refresh?: string
  /**
   * Set when this connection stopped working, so the UI can say so.
   *
   * A source that silently reads nothing is worse than one that errors: the
   * person believes their memory is current when it stopped updating days ago.
   */
  failing?: { at: string; detail: string }
}

export type User = {
  id: string
  /** The ENS name their namespaces hang under: tools.<namespace>. */
  namespace: string
  /**
   * A wallet that proved, on chain, that it owns `namespace`.
   *
   * Its absence is meaningful: without it the namespace is a subdomain this
   * host lends the person, and the host could take it back. With it, the name
   * is theirs and the claims under it survive this site disappearing. The UI
   * says which of the two is true rather than blurring them.
   */
  wallet?: { address: string; name: string; verifiedAt: string }
  /** Display identity from the provider they signed in with. */
  login: string
  avatar?: string
  createdAt: string
  tokens: StoredToken[]
}

const root = (): string => {
  const base = process.env.RECALL_CACHE_DIR ?? '~/.recall'
  return base.startsWith('~') ? join(homedir(), base.slice(1)) : resolve(base)
}
const usersDir = (): string => join(root(), 'users')
const userPath = (id: string): string => join(usersDir(), `${id}.json`)

// ---------------------------------------------------------------------------
// Token encryption
// ---------------------------------------------------------------------------

/**
 * The key that protects stored access tokens.
 *
 * Refusing to start without one is deliberate. A default or derived key would
 * mean the tokens are encrypted in name only, and these tokens read other
 * people's accounts — the failure mode is not "our demo broke", it is "someone
 * who read one file can read every connected account".
 */
function encryptionKey(): Buffer {
  const raw = process.env.CONNECT_SECRET?.trim()
  if (!raw) throw new Error('CONNECT_SECRET is not set — generate one with `openssl rand -hex 32`. Access tokens are not stored without it.')
  const key = raw.length === 64 ? Buffer.from(raw, 'hex') : createHash('sha256').update(raw).digest()
  if (key.length !== 32) throw new Error('CONNECT_SECRET must be 32 bytes (64 hex characters)')
  return key
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return `${iv.toString('hex')}:${c.getAuthTag().toString('hex')}:${enc.toString('hex')}`
}

export function decryptSecret(stored: string): string {
  const [ivHex, tagHex, dataHex] = stored.split(':')
  if (!ivHex || !tagHex || !dataHex) throw new Error('malformed stored token')
  const d = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivHex, 'hex'))
  d.setAuthTag(Buffer.from(tagHex, 'hex'))
  return Buffer.concat([d.update(Buffer.from(dataHex, 'hex')), d.final()]).toString('utf8')
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export function readUser(id: string): User | null {
  const p = userPath(id)
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, 'utf8')) as User } catch { return null }
}

export function writeUser(u: User): void {
  mkdirSync(usersDir(), { recursive: true })
  const p = userPath(u.id)
  const tmp = `${p}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(u, null, 2), { mode: 0o600 })
  renameSync(tmp, p)
}

export function allUsers(): User[] {
  const d = usersDir()
  if (!existsSync(d)) return []
  return readdirSync(d)
    // `.grants.json` and `.activity.json` live in the same directory and are
    // not users. Reading them produced records with no id and no namespace,
    // which a scheduled pass then tried to tick.
    .filter((f) => f.endsWith('.json') && !f.endsWith('.grants.json') && !f.endsWith('.activity.json'))
    .map((f) => { try { return JSON.parse(readFileSync(join(d, f), 'utf8')) as User } catch { return null } })
    .filter((u): u is User => !!u && typeof u.id === 'string' && typeof u.namespace === 'string')
}

/** A stable id for a provider account, so signing in twice is the same person. */
export const userIdFor = (provider: Provider, providerId: string): string =>
  createHash('sha256').update(`${provider}:${providerId}`).digest('hex').slice(0, 24)

/**
 * A stable id for a wallet.
 *
 * The address itself would do, but hashing keeps every id in this store the
 * same shape and keeps an address out of a filename.
 */
export const userIdForWallet = (address: string): string =>
  createHash('sha256').update(`wallet:${address.toLowerCase()}`).digest('hex').slice(0, 24)

/**
 * Create the person on first wallet sign-in, or return the one already there.
 *
 * The ENS name they proved *is* their namespace. There is no host-issued
 * subdomain to upgrade from, which is the point: a namespace this site handed
 * out is one this site could take back, and the whole argument is that memory
 * written here survives us. `verifyNameControl` has already checked the
 * signature and the registry before anything reaches here.
 */
export function upsertWalletUser(input: { address: string; name: string; avatar?: string }): User {
  const id = userIdForWallet(input.address)
  const existing = readUser(id)
  const wallet = { address: input.address, name: input.name, verifiedAt: new Date().toISOString() }

  if (existing) {
    // Someone can prove a different name with the same wallet. Their claims stay
    // where they were written — moving them would rewrite provenance — and new
    // ones go under the name they just proved.
    existing.wallet = wallet
    existing.namespace = input.name
    writeUser(existing)
    return existing
  }

  const u: User = {
    id,
    namespace: input.name,
    login: input.name,
    ...(input.avatar ? { avatar: input.avatar } : {}),
    createdAt: new Date().toISOString(),
    tokens: [],
    wallet,
  }
  writeUser(u)
  return u
}

/** Store (or replace) a provider token for this user. */
export function putToken(userId: string, token: Omit<StoredToken, 'secret' | 'refresh'> & { accessToken: string; refreshToken?: string }): User {
  const u = readUser(userId)
  if (!u) throw new Error(`no user ${userId}`)
  const { accessToken, refreshToken, ...rest } = token
  const next: StoredToken = {
    ...rest,
    secret: encryptSecret(accessToken),
    ...(refreshToken ? { refresh: encryptSecret(refreshToken) } : {}),
  }
  u.tokens = [...u.tokens.filter((t) => t.provider !== token.provider), next]
  writeUser(u)
  return u
}

/** The decrypted access token for a provider, or null if not connected. */
export function accessToken(userId: string, provider: Provider): string | null {
  const t = readUser(userId)?.tokens.find((x) => x.provider === provider)
  if (!t) return null
  try { return decryptSecret(t.secret) } catch { return null }
}

/** The stored refresh token for a provider, if one was issued. */
export function refreshToken(userId: string, provider: Provider): string | null {
  const t = readUser(userId)?.tokens.find((x) => x.provider === provider)
  if (!t?.refresh) return null
  try { return decryptSecret(t.refresh) } catch { return null }
}

/** Whether the stored access token has passed, or is about to pass, its expiry. */
export function tokenExpired(userId: string, provider: Provider, skewMs = 60_000): boolean {
  const t = readUser(userId)?.tokens.find((x) => x.provider === provider)
  if (!t?.expiresAt) return false
  return Date.parse(t.expiresAt) - skewMs <= Date.now()
}

/** Replace a stored access token in place, keeping the refresh token it came with. */
export function updateAccessToken(
  userId: string,
  provider: Provider,
  next: { accessToken: string; refreshToken?: string; expiresIn?: number },
): void {
  const u = readUser(userId)
  const t = u?.tokens.find((x) => x.provider === provider)
  if (!u || !t) return
  t.secret = encryptSecret(next.accessToken)
  // Providers may or may not rotate the refresh token. Keeping the old one when
  // none comes back is what lets a connection survive indefinitely.
  if (next.refreshToken) t.refresh = encryptSecret(next.refreshToken)
  if (next.expiresIn) t.expiresAt = new Date(Date.now() + next.expiresIn * 1000).toISOString()
  else delete t.expiresAt
  writeUser(u)
}

/**
 * Disconnect a provider. The claims it wrote stay, and stay attributed — that
 * is the whole point of the namespace being theirs.
 */
export function removeToken(userId: string, provider: Provider): boolean {
  const u = readUser(userId)
  if (!u) return false
  const before = u.tokens.length
  u.tokens = u.tokens.filter((t) => t.provider !== provider)
  if (u.tokens.length === before) return false
  writeUser(u)
  return true
}

export function deleteUser(id: string): boolean {
  const p = userPath(id)
  if (!existsSync(p)) return false
  unlinkSync(p)
  return true
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/**
 * A signed session value for the browser cookie.
 *
 * The cookie carries the user id and a signature, never a provider token. If
 * someone steals the cookie they can use the site as that person; they cannot
 * walk away with a GitHub token and use it anywhere else.
 */
/**
 * A signed session. With `identity`, the wallet and name it proved travel in the
 * cookie too: on a serverless host each request can land on a different
 * instance with its own empty disk, and a session that pointed only at a user
 * file there sent the person back to sign in, on every page — a signing loop.
 */
export function signSession(userId: string, identity?: { address: string; name: string }): string {
  const who = identity ? `~${Buffer.from(JSON.stringify(identity)).toString('base64url')}` : ''
  const payload = `${userId}${who}.${Date.now()}`
  const mac = createHash('sha256').update(`${payload}.${encryptionKey().toString('hex')}`).digest('hex').slice(0, 32)
  return `${payload}.${mac}`
}

/** The verified parts of a session cookie, or null if it is forged, malformed or expired. */
function openSession(cookie: string | undefined, maxAgeDays: number): { userId: string; identity: { address: string; name: string } | null } | null {
  if (!cookie) return null
  const [head, issued, mac] = cookie.split('.')
  if (!head || !issued || !mac) return null
  const expected = createHash('sha256').update(`${head}.${issued}.${encryptionKey().toString('hex')}`).digest('hex').slice(0, 32)
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  // Inclusive: a zero max age must reject, and an age exactly at the limit is
  // expired rather than valid on its final millisecond.
  if (Date.now() - Number(issued) >= maxAgeDays * 86_400_000) return null
  const [userId, who] = head.split('~')
  let identity: { address: string; name: string } | null = null
  if (who) {
    try {
      const j = JSON.parse(Buffer.from(who, 'base64url').toString('utf8')) as { address?: unknown; name?: unknown }
      if (typeof j.address === 'string' && typeof j.name === 'string') identity = { address: j.address, name: j.name }
    } catch { /* an unreadable identity is simply absent */ }
  }
  return userId ? { userId, identity } : null
}

/** The identity a session carries — the wallet and the name it proved — when it has one. */
export const sessionIdentity = (cookie: string | undefined, maxAgeDays = SESSION.days): { address: string; name: string } | null =>
  openSession(cookie, maxAgeDays)?.identity ?? null

export function verifySession(cookie: string | undefined, maxAgeDays = SESSION.days): string | null {
  return openSession(cookie, maxAgeDays)?.userId ?? null
}

export const SESSION_COOKIE = 'knowledge_session'


/**
 * Record a proven ENS name and move this person's namespace onto it.
 *
 * Claims already written under the old namespace are not moved. They stay
 * where they are, still readable and still theirs to export — rewriting history
 * to make it look like it always lived here would be the one thing a
 * provenance-keeping system must not do.
 */
export function attachWallet(userId: string, wallet: { address: string; name: string }): User {
  const u = readUser(userId)
  if (!u) throw new Error(`no user ${userId}`)
  u.wallet = { ...wallet, verifiedAt: new Date().toISOString() }
  u.namespace = wallet.name
  writeUser(u)
  return u
}

/** Forget a wallet. The namespace stays pointed at the name it proved. */
export function detachWallet(userId: string): User {
  const u = readUser(userId)
  if (!u) throw new Error(`no user ${userId}`)
  delete u.wallet
  writeUser(u)
  return u
}
