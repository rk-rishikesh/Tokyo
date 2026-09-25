/** Wait for a transaction the owner sent from their own wallet. */
import { NextResponse } from 'next/server'
import { waitForTx } from '@k01/connect'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const { hash } = (await req.json()) as { hash?: string }
  if (!hash || !/^0x[0-9a-fA-F]{64}$/.test(hash)) return NextResponse.json({ error: 'a transaction hash is required' }, { status: 400 })
  try {
    return NextResponse.json(await waitForTx(hash as `0x${string}`))
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 504 })
  }
}
