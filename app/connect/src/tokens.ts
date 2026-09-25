/**
 * Keeping a connection alive.
 *
 * Every OAuth access token here expires — Granola's within hours, Google's
 * within one. Refresh tokens were being stored correctly and `refreshAccessToken`
 * had been written, but nothing ever called it. So a source worked on the day it
 * was connected and then went quiet: `tools/list` came back
 * `401 Session expired`, the reader caught it, returned no findings, and the
 * watcher reported nothing to write. A dead connection and a quiet week look
 * identical from the outside, which is why it took a person noticing their call
 * never landed to find it.
 *
 * `liveToken` is the only way a reader should obtain a token. It refreshes ahead
 * of expiry, records the failure when refresh is impossible, and returns null
 * rather than handing back a credential that will 401.
 */
import { refreshAccessToken } from './oauth.js'
import {
  accessToken, readUser, refreshToken, tokenExpired, updateAccessToken, writeUser,
  type Provider,
} from './users.js'

export type TokenState =
  | { ok: true; token: string; refreshed: boolean }
  | { ok: false; reason: 'not-connected' | 'expired' | 'refresh-failed'; detail?: string }

/**
 * Refreshes are per user and provider, so two passes starting at once do not
 * both spend the refresh token — some providers rotate it, and the loser of
 * that race would be left holding a credential the provider has already
 * invalidated.
 */
const inFlight = new Map<string, Promise<TokenState>>()

async function refreshNow(userId: string, provider: Provider): Promise<TokenState> {
  const refresh = refreshToken(userId, provider)
  if (!refresh) return { ok: false, reason: 'expired', detail: 'no refresh token was issued — reconnect this source' }

  try {
    const next = await refreshAccessToken(provider, refresh)
    updateAccessToken(userId, provider, {
      accessToken: next.accessToken,
      ...(next.refreshToken ? { refreshToken: next.refreshToken } : {}),
      ...(next.expiresIn ? { expiresIn: next.expiresIn } : {}),
    })
    noteConnectionOk(userId, provider)
    return { ok: true, token: next.accessToken, refreshed: true }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    noteConnectionFailed(userId, provider, detail)
    return { ok: false, reason: 'refresh-failed', detail }
  }
}

/**
 * A token that will work, or a reason it will not.
 *
 * Refreshes a minute before expiry rather than after it, so a pass that takes
 * time does not start with a valid token and finish with an expired one.
 */
export async function liveToken(userId: string, provider: Provider): Promise<TokenState> {
  const current = accessToken(userId, provider)
  if (!current) return { ok: false, reason: 'not-connected' }
  if (!tokenExpired(userId, provider)) return { ok: true, token: current, refreshed: false }

  const key = `${userId}:${provider}`
  const running = inFlight.get(key)
  if (running) return running

  const p = refreshNow(userId, provider).finally(() => inFlight.delete(key))
  inFlight.set(key, p)
  return p
}

/** Just the token, for callers that only need the happy path. */
export const tokenFor = async (userId: string, provider: Provider): Promise<string | null> => {
  const s = await liveToken(userId, provider)
  return s.ok ? s.token : null
}

// ---------------------------------------------------------------------------
// Connection health
// ---------------------------------------------------------------------------

/**
 * Why a source stopped working, kept on the user so the UI can say so.
 *
 * A source that silently reads nothing is the worst failure this product has:
 * the person believes their memory is current when it stopped updating days
 * ago. Recording the reason is what turns that into something the interface can
 * report and the person can fix.
 */
export function noteConnectionFailed(userId: string, provider: Provider, detail: string): void {
  const u = readUser(userId)
  const t = u?.tokens.find((x) => x.provider === provider)
  if (!u || !t) return
  t.failing = { at: new Date().toISOString(), detail: detail.slice(0, 300) }
  writeUser(u)
}

export function noteConnectionOk(userId: string, provider: Provider): void {
  const u = readUser(userId)
  const t = u?.tokens.find((x) => x.provider === provider)
  if (!u || !t?.failing) return
  delete t.failing
  writeUser(u)
}

/** Providers this person connected that are no longer working, and why. */
export function brokenConnections(userId: string): { provider: Provider; at: string; detail: string }[] {
  return (readUser(userId)?.tokens ?? [])
    .filter((t) => t.failing)
    .map((t) => ({ provider: t.provider, at: t.failing!.at, detail: t.failing!.detail }))
}
