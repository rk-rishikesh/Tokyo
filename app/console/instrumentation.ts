/**
 * Fail at boot, not on a stranger's first click.
 *
 * Next runs this once when the server starts. A deployment missing
 * CONNECT_SECRET used to start cleanly and then throw inside the OAuth callback,
 * so the first person to try signing in got a 500 and the operator got a stack
 * trace naming a decryption failure rather than a missing variable.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { configReport } = await import('@k01/connect/config')
  const report = configReport()
  if (!report) return

  // In development this is a warning: someone exploring the protocol pages has
  // no reason to configure sign-in first. In production it is fatal, because a
  // deployment that cannot serve anybody should not claim to be up.
  if (process.env.NODE_ENV === 'production') throw new Error(report)
  console.warn(`\n${report}\n`)
}
