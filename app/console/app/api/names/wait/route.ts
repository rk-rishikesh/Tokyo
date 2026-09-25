/**
 * Wait until the chain agrees a name is owned.
 *
 * A wallet returns a transaction hash the moment it is broadcast, not when it
 * is mined. Registration looked complete and the very next check asked the
 * registry who owned the name — which was still nobody, so a registration that
 * had in fact succeeded reported "owned by 0x000…0, not by the wallet that
 * signed".
 */
import { NextResponse } from 'next/server'
import { ownsName, rememberName } from '@knowledge01/connect'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request) {
  const { address, name } = (await req.json()) as { address?: string; name?: string }
  if (!address || !name) return NextResponse.json({ error: 'address and name are required' }, { status: 400 })

  // Sepolia blocks land every ~12s. Twenty tries at two seconds covers a slow
  // one without holding the request open long enough to be timed out.
  for (let i = 0; i < 20; i++) {
    if (await ownsName(address, name)) {
      // The one moment we can be certain this name belongs to this person.
      rememberName(name)
      return NextResponse.json({ ok: true, waitedMs: i * 2000 })
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  return NextResponse.json(
    { ok: false, error: 'the registration has not landed yet — it may still be pending' },
    { status: 409 },
  )
}
