/**
 * What a person can do with a name they typed: continue, or register it.
 */
import { NextResponse } from 'next/server'
import { statusOf } from '@knowledge01/connect'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const { address, name } = (await req.json()) as { address?: string; name?: string }
  if (!address || !name) return NextResponse.json({ error: 'address and name are required' }, { status: 400 })
  try {
    return NextResponse.json(await statusOf(address, name))
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'lookup failed' }, { status: 502 })
  }
}
