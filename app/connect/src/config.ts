/**
 * What a deployment needs before it can serve anybody.
 *
 * These were checked where they were used, which meant a misconfigured
 * deployment started fine and failed on a visitor's first click — with an error
 * naming a symptom rather than the variable. `CONNECT_SECRET` in particular is
 * only reached when someone signs in, so the one thing that must never be
 * missing was also the last thing to be noticed.
 *
 * Checking at boot moves the failure from a stranger's browser to the operator's
 * terminal, which is the only place it can be fixed.
 */
import { configuredBaseUrl } from './endpoints.js'

export type ConfigProblem = { key: string; why: string; fix: string }

export type Mode = 'hosted' | 'local'

/**
 * Hosted when any OAuth provider is configured, or when a base URL says this is
 * serving people other than whoever started it.
 */
export function deploymentMode(env: NodeJS.ProcessEnv = process.env): Mode {
  const hasProvider = ['GITHUB', 'GOOGLE', 'LINEAR'].some(
    (p) => env[`${p}_CLIENT_ID`]?.trim() && env[`${p}_CLIENT_SECRET`]?.trim(),
  )
  const base = configuredBaseUrl(env)
  const isRemote = !!base && !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(base)
  return hasProvider || isRemote ? 'hosted' : 'local'
}

const HEX32 = /^[0-9a-f]{64}$/i

/** Everything wrong with this deployment's configuration, in the order to fix it. */
export function configProblems(env: NodeJS.ProcessEnv = process.env): ConfigProblem[] {
  const out: ConfigProblem[] = []
  const mode = deploymentMode(env)

  if (mode === 'hosted') {
    const secret = env.CONNECT_SECRET?.trim()
    if (!secret) {
      out.push({
        key: 'CONNECT_SECRET',
        why: 'encrypts stored access tokens and signs session cookies — without it nobody can sign in',
        fix: 'openssl rand -hex 32',
      })
    } else if (!HEX32.test(secret) && secret.length < 32) {
      out.push({
        key: 'CONNECT_SECRET',
        why: 'is too short to be a key; it protects tokens that read other people’s accounts',
        fix: 'openssl rand -hex 32',
      })
    }

    // No CONNECT_HOST_NAMESPACE. Namespaces are not issued by this deployment
    // any more — someone proves a name they already own, and that is where
    // their claims go. A host-issued subdomain was a name this site could take
    // back, which is the opposite of what the product claims.

    if (!configuredBaseUrl(env)) {
      out.push({
        key: 'CONNECT_BASE_URL',
        why: 'OAuth callbacks are built from it, and must match what each provider has registered',
        fix: 'CONNECT_BASE_URL=https://your.site',
      })
    }
  } else if (!env.CONNECT_OWNER?.trim() && !env.KNOWLEDGE_NAMESPACE?.trim()) {
    out.push({
      key: 'CONNECT_OWNER',
      why: 'says whose namespaces claims are written to',
      fix: 'CONNECT_OWNER=you.eth',
    })
  }

  return out
}

/** A single readable block for a terminal, or null when there is nothing wrong. */
export function configReport(env: NodeJS.ProcessEnv = process.env): string | null {
  const problems = configProblems(env)
  if (!problems.length) return null
  const lines = [`Cannot start in ${deploymentMode(env)} mode — ${problems.length} setting${problems.length === 1 ? '' : 's'} missing:`, '']
  for (const p of problems) {
    lines.push(`  ${p.key}`)
    lines.push(`    ${p.why}`)
    lines.push(`    ${p.fix}`)
    lines.push('')
  }
  lines.push('  See .env.example, or run: pnpm check:oauth')
  return lines.join('\n')
}

/**
 * Throw unless this deployment can serve someone.
 *
 * Called once at startup. The alternative — checking inside each handler — is
 * how a missing variable became a stranger's 500 rather than an operator's
 * boot failure.
 */
export function assertConfigured(env: NodeJS.ProcessEnv = process.env): void {
  const report = configReport(env)
  if (report) throw new Error(report)
}
