/**
 * Raw bytes by CID, as an IPFS gateway would serve them.
 *
 * Exactly what is stored — ciphertext for anything private. Decrypting is the
 * reader's business and happens wherever the reader's key is: for the owner's
 * recovery, in their own browser.
 */
import { networkObject } from '@k01/connect'

export async function GET(_req: Request, { params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params
  const bytes = await networkObject(cid)
  if (!bytes) return new Response('not found', { status: 404 })
  return new Response(new Uint8Array(bytes), { headers: { 'content-type': 'application/octet-stream', 'cache-control': 'public, max-age=31536000, immutable' } })
}
