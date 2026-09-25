/**
 * Record the public half of the owner's wallet-derived key, then seal every
 * namespace they have to it and publish.
 *
 * The private half is derived in the browser from a signature and never sent.
 * What arrives here could be sealed to by anyone; it is only useful to the
 * person who can sign the message again.
 */
import { NextResponse } from 'next/server'
import { protectWithOwnerKey, writeOwnerKey } from '@k01/connect'
import { ownerOf, viewer } from '@/lib/session'

export async function POST(req: Request) {
  const owner = ownerOf(await viewer())
  if (!owner) return NextResponse.json({ error: 'sign in first' }, { status: 401 })
  const { pubkey, address } = (await req.json()) as { pubkey?: string; address?: string }
  try {
    writeOwnerKey(owner, { pubkey: String(pubkey) as `0x${string}`, ...(address ? { address } : {}) })
    const sealed = await protectWithOwnerKey(owner)
    return NextResponse.json({ ok: true, sealed })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 })
  }
}
