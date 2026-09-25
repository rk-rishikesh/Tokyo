/**
 * One pass for every connected person.
 *
 * `tickAll` existed and nothing called it, so on a hosted deployment memory
 * only updated while somebody had the page open — an agent that watches your
 * accounts, but only while you are watching it.
 *
 * Protected by a shared secret rather than a session: this is called by a
 * scheduler, not a browser. Without CRON_SECRET set it refuses rather than
 * running open to the internet, because an unauthenticated endpoint that spends
 * everyone's model quota is a denial-of-service button.
 */
import { NextResponse } from 'next/server'
import { tickAll } from '@knowledge01/connect'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not set — scheduled passes are disabled' }, { status: 503 })
  }
  // Vercel Cron sends `authorization: Bearer <CRON_SECRET>`; anything else can
  // pass it as a query parameter.
  const auth = req.headers.get('authorization')
  const given = auth?.replace(/^Bearer\s+/i, '') ?? new URL(req.url).searchParams.get('key')
  if (given !== secret) return NextResponse.json({ error: 'not authorised' }, { status: 401 })

  const started = Date.now()
  try {
    const results = await tickAll()
    return NextResponse.json({
      users: results.length,
      written: results.reduce((n, r) => n + r.result.written.length, 0),
      broken: results.flatMap((r) => (r.result.broken ?? []).map((b) => ({ user: r.user, ...b }))),
      ms: Date.now() - started,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'pass failed' }, { status: 500 })
  }
}
