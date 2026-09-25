/**
 * Reading a Google Data Portability archive.
 *
 * The archive is a zip of JSON files. Node ships zlib but no zip reader, and
 * the format is simple enough that a dependency is not worth the supply-chain
 * surface for something that parses a stranger's download.
 *
 * Only the central directory is walked and only the entries that are wanted are
 * inflated, so a multi-gigabyte archive costs one pass over its index rather
 * than a full extraction. Nothing is written to disk.
 *
 * This is deliberately strict about size. An archive is the one input here that
 * a person can make arbitrarily large without meaning to, and a reader that
 * happily inflates whatever it is given is how a zip bomb gets in.
 */
import { inflateRawSync } from 'node:zlib'

/** Refuse anything that would be unreasonable for an activity file. */
const MAX_ENTRY = 64 * 1024 * 1024
const MAX_TOTAL = 256 * 1024 * 1024

export type ZipEntry = { name: string; size: number; read: () => string }

const EOCD = 0x06054b50
const CD = 0x02014b50

/**
 * List what is in a zip, without inflating any of it.
 *
 * Reads the end-of-central-directory record backwards from the tail, then walks
 * the directory. Each entry comes back with a `read` that inflates only that
 * file, so a caller can look at the names and take two of four hundred.
 */
export function readZip(buf: Buffer): ZipEntry[] {
  // The EOCD is at the end, after a comment of up to 64KB.
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66_000); i--) {
    if (buf.readUInt32LE(i) === EOCD) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('not a zip file')

  const count = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16)
  const entries: ZipEntry[] = []
  let total = 0

  for (let i = 0; i < count && off + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(off) !== CD) break
    const method = buf.readUInt16LE(off + 10)
    const compressed = buf.readUInt32LE(off + 20)
    const size = buf.readUInt32LE(off + 24)
    const nameLen = buf.readUInt16LE(off + 28)
    const extraLen = buf.readUInt16LE(off + 30)
    const commentLen = buf.readUInt16LE(off + 32)
    const localOff = buf.readUInt32LE(off + 42)
    const name = buf.subarray(off + 46, off + 46 + nameLen).toString('utf8')

    total += size
    if (size > MAX_ENTRY || total > MAX_TOTAL) throw new Error('archive is larger than this reader will inflate')

    if (!name.endsWith('/')) {
      entries.push({
        name,
        size,
        read: () => {
          // The local header repeats the name and extra fields at its own
          // lengths, which are not always the directory's.
          const lnLen = buf.readUInt16LE(localOff + 26)
          const leLen = buf.readUInt16LE(localOff + 28)
          const start = localOff + 30 + lnLen + leLen
          const data = buf.subarray(start, start + compressed)
          if (method === 0) return data.toString('utf8')
          if (method === 8) return inflateRawSync(data, { maxOutputLength: MAX_ENTRY }).toString('utf8')
          throw new Error(`unsupported compression in ${name}`)
        },
      })
    }
    off += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

/**
 * Fetch an archive and pull out the files worth reading.
 *
 * Google splits an export across several urls, and names files by product —
 * `Takeout/My Activity/YouTube/MyActivity.json` and so on — so entries are
 * matched by path rather than position.
 */
export async function fetchArchive(urls: string[], wanted: RegExp): Promise<{ name: string; json: string }[]> {
  const out: { name: string; json: string }[] = []
  for (const url of urls) {
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) })
    if (!res.ok) throw new Error(`archive download: ${res.status}`)
    const len = Number(res.headers.get('content-length') ?? 0)
    if (len > MAX_TOTAL) throw new Error('archive is larger than this reader will download')

    const buf = Buffer.from(await res.arrayBuffer())
    for (const entry of readZip(buf)) {
      if (!wanted.test(entry.name)) continue
      try { out.push({ name: entry.name, json: entry.read() }) }
      catch (e) { console.warn(`  archive: ${entry.name} — ${e instanceof Error ? e.message : String(e)}`) }
    }
  }
  return out
}

/** The files worth reading out of a Data Portability export. */
export const ACTIVITY_FILES = /My ?Activity.*\.json$|Purchases|Reservations|Orders/i
