/**
 * A content-addressed store on disk, with the same semantics as IPFS.
 *
 * The local stand-in for the network. It exists so the portability claim can be
 * demonstrated on one machine without a pinning account or testnet gas — and it
 * is deliberately *not* inside either application's data directory. Deleting the
 * demo app's state does not touch it, which is the whole point: it plays the
 * role IPFS plays in production, a place neither agent owns.
 *
 * Refs are real CIDv1s of the stored bytes, encryption is the same AES-GCM the
 * Pinata path uses, and revoke re-keys. Only the transport differs.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { MemoryAdapter, type ByteStore } from './memory.js'

class DirectoryStore implements ByteStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true })
  }

  // Two levels of fan-out, as git does, so a busy namespace does not put ten
  // thousand files in one directory.
  private path(ref: string): string {
    return join(this.dir, ref.slice(-4, -2), ref.slice(-2), ref)
  }

  get(ref: string): Uint8Array | undefined {
    const p = this.path(ref)
    return existsSync(p) ? new Uint8Array(readFileSync(p)) : undefined
  }

  set(ref: string, bytes: Uint8Array): void {
    const p = this.path(ref)
    if (existsSync(p)) return // content-addressed: same ref, same bytes
    mkdirSync(dirname(p), { recursive: true })
    const tmp = `${p}.${process.pid}.tmp`
    writeFileSync(tmp, bytes)
    renameSync(tmp, p)
  }
}

export class FileAdapter extends MemoryAdapter {
  constructor(readonly dir: string) {
    super(new DirectoryStore(dir))
  }
}
