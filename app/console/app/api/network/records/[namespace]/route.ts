/**
 * A namespace's public records, as an ENS gateway would serve them.
 *
 * The contenthash and the access manifest's CID. Both are public on a real
 * network — the manifest holds public keys and sealed keys, nothing a reader
 * without the matching private key can use.
 */
import { NextResponse } from 'next/server'
import { publicRecords } from '@k01/connect'

export async function GET(_req: Request, { params }: { params: Promise<{ namespace: string }> }) {
  const { namespace } = await params
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.eth$/.test(namespace)) return NextResponse.json({ error: 'not an ENS name' }, { status: 400 })
  return NextResponse.json(await publicRecords(namespace), { headers: { 'cache-control': 'no-store' } })
}
