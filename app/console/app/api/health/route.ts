/**
 * Whether this deployment can actually serve anybody.
 *
 * Reports configuration problems by name rather than returning a bare "ok",
 * because the failure this exists to catch is a deployment that starts fine and
 * cannot sign anyone in.
 */
import { NextResponse } from 'next/server'
import { configProblems, deploymentMode } from '@knowledge01/connect/config'

export const dynamic = 'force-dynamic'

export async function GET() {
  const problems = configProblems()
  return NextResponse.json(
    {
      ok: problems.length === 0,
      mode: deploymentMode(),
      scheduledPasses: process.env.CRON_SECRET ? 'enabled' : 'disabled — set CRON_SECRET',
      // The keys only; the values are secrets and the reasons are already in
      // the operator's logs.
      missing: problems.map((p) => p.key),
    },
    { status: problems.length ? 503 : 200 },
  )
}
