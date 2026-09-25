/**
 * Hand out a message to sign, and remember the nonce that makes it single-use.
 */
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { challengeMessage, newState } from '@k01/connect'

export async function POST(req: Request) {
  // No session required: this is how a session begins.
  const jar = await cookies()
  const { address, name } = (await req.json()) as { address?: string; name?: string }
  if (!address || !name) return NextResponse.json({ error: 'address and name are required' }, { status: 400 })
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return NextResponse.json({ error: 'that is not an address' }, { status: 400 })

  const nonce = newState()
  jar.set('wallet_nonce', nonce, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 600 })

  const url = new URL(req.url)
  return NextResponse.json({ message: challengeMessage({ address, name, nonce, domain: url.host }) })
}
