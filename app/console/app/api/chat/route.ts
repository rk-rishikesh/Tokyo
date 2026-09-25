/**
 * Chat, and the approval of anything it wants to change.
 *
 * Both paths resolve the viewer first. A write is only ever executed through
 * `approve`, and only for the person whose session asked for it.
 */
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { approve, ask, readUser, SESSION_COOKIE, verifySession, type ChatTurn, type PendingAction } from '@recall/connect'

export async function POST(req: Request) {
  const jar = await cookies()
  const id = verifySession(jar.get(SESSION_COOKIE)?.value)
  const user = id ? readUser(id) : null
  if (!user) return NextResponse.json({ error: 'sign in first' }, { status: 401 })

  const body = (await req.json()) as { message?: string; history?: ChatTurn[]; approve?: PendingAction }

  if (body.approve) {
    const out = await approve(user, body.approve)
    return NextResponse.json(out)
  }
  if (!body.message?.trim()) return NextResponse.json({ error: 'say something' }, { status: 400 })

  try {
    return NextResponse.json(await ask(user, body.history ?? [], body.message))
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'chat failed' }, { status: 500 })
  }
}
