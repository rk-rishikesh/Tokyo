/**
 * Read your own memory in the browser, with nothing but your wallet.
 *
 * The page asks the wallet for one signature, derives the owner key from it,
 * and decrypts the namespace here. The server is only a gateway: it hands over
 * a contenthash, a manifest of sealed keys, and ciphertext — the same bytes
 * IPFS and ENS would hand anyone. The private key never leaves this tab.
 *
 * This file is the independent reader, re-implemented without a line of the
 * app's code, which is the point: if it can read your memory, so could any
 * program you gave the same key.
 */
import { decrypt as eciesDecrypt } from 'eciesjs'
import { hexToBytes, type Hex } from 'viem'
import { OWNER_KEY_MESSAGE, ownerKeyFromSignature } from '@knowledge01/repo/owner-key'

type Eth = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> }
export const injected = (): Eth | null =>
  typeof window !== 'undefined' ? ((window as unknown as { ethereum?: Eth }).ethereum ?? null) : null

export type OwnerKey = { privateKey: Hex; pubkey: Hex; address: string }

/** One signature → the owner key. Deterministic: sign again, get the same key. */
export async function deriveOwnerKey(name: string): Promise<OwnerKey> {
  const eth = injected()
  if (!eth) throw new Error('no wallet in this browser')
  const [address] = (await eth.request({ method: 'eth_requestAccounts' })) as string[]
  if (!address) throw new Error('the wallet returned no account')
  const signature = (await eth.request({ method: 'personal_sign', params: [OWNER_KEY_MESSAGE(name), address] })) as Hex
  return { ...ownerKeyFromSignature(signature), address }
}

type Grant = { id: string; agent: string; pubkey: Hex; role: string; wrappedKey?: Hex; owner?: boolean }
type Manifest = { kind: 'access'; namespace: string; readers: 'public' | 'key'; keyVersion: number; grants: Grant[] }
type Claim = { id: string; claim: string; subject: string | null; topic: string | null; confidence: number; sources: { type: string; name?: string }[] }
type Commit = { id: string; parents: string[]; timestamp: string; message: string; snapshot: Record<string, Claim> }
type Refs = { kind: 'refs'; namespace: string; head: string; branches: Record<string, string>; objects: Record<string, string>; updatedAt: string }

export type Recovered =
  | { namespace: string; ok: true; claims: Claim[]; version: number; publishedAt: string; refsCid: string; bytesFetched: number; source: 'chain' | 'staged' }
  | { namespace: string; ok: false; reason: string }

const json = <T,>(bytes: Uint8Array): T => JSON.parse(new TextDecoder().decode(bytes)) as T

async function fetchObject(cid: string): Promise<Uint8Array> {
  const r = await fetch(`/api/network/object/${cid}`)
  if (!r.ok) throw new Error(`the network has no object ${cid}`)
  return new Uint8Array(await r.arrayBuffer())
}

/** AES-256-GCM, laid out `iv(12) || ciphertext || tag(16)` — which is what WebCrypto expects after the iv. */
async function open(payload: Uint8Array, key: Uint8Array): Promise<Uint8Array> {
  const bytes = new Uint8Array(payload)
  const k = await crypto.subtle.importKey('raw', new Uint8Array(key), 'AES-GCM', false, ['decrypt'])
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, k, bytes.slice(12)))
}

export async function recoverNamespace(namespace: string, key: OwnerKey): Promise<Recovered> {
  let fetched = 0
  const get = async (cid: string) => { const b = await fetchObject(cid); fetched += b.length; return b }
  try {
    const rec = (await (await fetch(`/api/network/records/${namespace}`)).json()) as { refsCid: string | null; access: string | null; source: 'chain' | 'staged' }
    if (!rec.refsCid) return { namespace, ok: false, reason: 'never published to the network' }

    let contentKey: Uint8Array | null = null
    if (rec.access) {
      const m = json<Manifest>(await get(rec.access))
      if (m.readers === 'key') {
        const mine = m.grants.find((g) => g.pubkey.toLowerCase() === key.pubkey.toLowerCase())
        if (!mine?.wrappedKey) return { namespace, ok: false, reason: 'not sealed to your wallet key yet' }
        contentKey = new Uint8Array(eciesDecrypt(hexToBytes(key.privateKey), hexToBytes(mine.wrappedKey)))
      }
    }
    const read = async (cid: string) => (contentKey ? open(await get(cid), contentKey) : get(cid))

    const refs = json<Refs>(await read(rec.refsCid))
    const headId = refs.branches[refs.head]
    if (!headId || !refs.objects[headId]) return { namespace, ok: false, reason: 'published, but with no commits' }
    const head = json<Commit>(await read(refs.objects[headId]!))
    if (head.id !== headId) return { namespace, ok: false, reason: 'the network returned a different commit than the one named' }

    let version = 1
    for (let c = head; c.parents[0] && refs.objects[c.parents[0]]; version++) c = json<Commit>(await read(refs.objects[c.parents[0]]!))

    return { namespace, ok: true, claims: Object.values(head.snapshot), version, publishedAt: refs.updatedAt, refsCid: rec.refsCid, bytesFetched: fetched, source: rec.source }
  } catch (e) {
    return { namespace, ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}
