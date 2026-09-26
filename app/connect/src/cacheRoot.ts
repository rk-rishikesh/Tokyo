/**
 * Where this app keeps its local state: users, grants, staged records, caches.
 *
 * RECALL_CACHE_DIR, or ~/.recall. On Vercel the only writable disk is the
 * instance's temp directory — writing under the home directory throws, and a
 * sign-in that cannot save its user answered 500 and asked for the signature
 * again. There the state goes to temp, which is per instance and short-lived;
 * the signed session cookie carries enough to rebuild a user on any instance.
 */
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export function cacheRoot(): string {
  const base = process.env.RECALL_CACHE_DIR?.trim() || '~/.recall'
  const dir = base.startsWith('~') ? join(homedir(), base.slice(1)) : resolve(base)
  if (process.env.VERCEL && !dir.startsWith(tmpdir())) return join(tmpdir(), 'recall')
  return dir
}
