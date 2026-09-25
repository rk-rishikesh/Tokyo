/**
 * Which names this wallet owns, so the person picks rather than types.
 *
 * ENSv2 has no reverse index, so this checks candidates the deployment already
 * knows about. It cannot claim to be exhaustive and the interface does not say
 * it is — there is a box for a name we did not think to check.
 */
import { NextResponse } from 'next/server'
import { candidateNames, namesOwnedBy } from '@recall/connect'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const { address } = (await req.json()) as { address?: string }
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: 'that is not an address' }, { status: 400 })
  }
  try {
    return NextResponse.json({ names: await namesOwnedBy(address, candidateNames()) })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'lookup failed' }, { status: 502 })
  }
}
