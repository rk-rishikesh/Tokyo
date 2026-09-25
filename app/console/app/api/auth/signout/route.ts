/**
 * Sign out: drop the cookie.
 *
 * The user record and everything it wrote stay. Their claims are theirs, and
 * signing back in with the same provider account returns them — the opposite of
 * a vendor clearing your memory when you leave.
 */
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { SESSION_COOKIE } from '@k01/connect'

export async function POST(req: Request) {
  const jar = await cookies()
  jar.delete(SESSION_COOKIE)
  return NextResponse.redirect(new URL('/app', new URL(req.url).origin), { status: 303 })
}
