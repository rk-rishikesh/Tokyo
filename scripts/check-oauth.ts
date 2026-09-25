/**
 * What each provider needs, and whether it has it.
 *
 * OAuth fails in ways that name the wrong cause — a mismatched callback reports
 * a redirect_uri error, an unreachable client id reports "application not
 * found". Printing what this deployment will actually send, next to what has to
 * be registered, turns those into something checkable before the round trip.
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: new URL('../.env', import.meta.url).pathname })

const { callbackUrl, cachedRegistration, configuredProviders, isPubliclyReachable, providerConfig } = await import('../app/connect/src/oauth.js')

const WHERE: Record<string, string> = {
  github: 'https://github.com/settings/developers → OAuth Apps → New OAuth App',
  linear: 'https://linear.app/settings/api → OAuth applications → Create new',
  google: 'https://console.cloud.google.com → APIs & Services → Credentials → OAuth client ID (Web application)',
  granola: 'nothing to register — this one introduces itself',
}

const base = process.env.CONNECT_BASE_URL ?? 'http://localhost:3000'
console.log(`base URL      ${base}`)
console.log(`reachable     ${isPubliclyReachable() ? 'yes — providers can fetch this host' : 'no — localhost or private, so CIMD is unavailable'}`)
console.log()

for (const p of ['github', 'linear', 'google', 'granola'] as const) {
  const cfg = providerConfig(p)
  const ready = p === 'granola' ? !!cfg || !isPubliclyReachable() : !!cfg
  console.log(`${ready ? '✓' : '·'} ${p}`)
  console.log(`    callback   ${callbackUrl(p)}`)
  if (cfg) {
    console.log(`    client id  ${cfg.clientId.slice(0, 40)}${cfg.clientId.length > 40 ? '…' : ''}`)
    console.log(`    scopes     ${cfg.scopes.join(' ')}`)
  } else if (p === 'granola') {
    const reg = cachedRegistration('granola')
    console.log(`    ${reg ? `registered as ${reg.clientId}` : 'registers automatically on first Connect'}`)
  } else {
    console.log(`    missing    ${p.toUpperCase()}_CLIENT_ID and ${p.toUpperCase()}_CLIENT_SECRET`)
    console.log(`    get them   ${WHERE[p]}`)
  }
  console.log()
}

const ready = configuredProviders()
console.log(`/app will offer: ${ready.length ? ready.join(', ') : 'nothing — no provider is configured'}`)
if (!process.env.CONNECT_SECRET) console.log('\n! CONNECT_SECRET is not set — sign-in will fail. Generate one with: openssl rand -hex 32')
