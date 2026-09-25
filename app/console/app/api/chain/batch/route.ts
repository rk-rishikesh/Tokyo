/**
 * Every call the chain still needs, for a wallet that batches (EIP-5792).
 * The server builds calldata; the owner's wallet sends it, once.
 */
import { NextResponse } from 'next/server'
import { chainBatch } from '@k01/connect'
import { ownerOf, viewer } from '@/lib/session'

export const dynamic = 'force-dynamic'
const json = (v: unknown, status = 200) =>
  new NextResponse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)), { status, headers: { 'content-type': 'application/json' } })

export async function POST(req: Request) {
  const owner = ownerOf(await viewer())
  if (!owner) return json({ error: 'sign in first' }, 401)
  const { address } = (await req.json()) as { address?: string }
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) return json({ error: 'a wallet address is required' }, 400)
  try {
    return json(await chainBatch(owner, address as `0x${string}`))
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400)
  }
}
