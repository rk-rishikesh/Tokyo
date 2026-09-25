/**
 * The next transaction the owner's wallet should send, as calldata.
 *
 * Stages everything first (bytes to IPFS, records locally), then asks the
 * planner what the chain is missing. The server never signs; the planner has
 * already simulated the step as the owner, so a revert shows up here rather
 * than as a failed transaction.
 */
import { NextResponse } from 'next/server'
import { nextChainStep } from '@recall/connect'
import { ownerOf, viewer } from '@/lib/session'

export const dynamic = 'force-dynamic'
const json = (v: unknown, status = 200) =>
  new NextResponse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)), { status, headers: { 'content-type': 'application/json' } })

export async function POST(req: Request) {
  const owner = ownerOf(await viewer())
  if (!owner) return json({ error: 'sign in first' }, 401)
  const { address, stage } = (await req.json()) as { address?: string; stage?: boolean }
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) return json({ error: 'a wallet address is required' }, 400)
  try {
    return json(await nextChainStep(owner, address as `0x${string}`, { stage: !!stage }))
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400)
  }
}
