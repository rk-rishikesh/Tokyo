/**
 * Every source, as one entry each.
 *
 * Adding a connector used to mean editing four files — the workspace manifest,
 * a branch in the watcher's dispatch chain, the OAuth provider table, and the
 * console. Four chances to forget one, which is how GitHub came to silently use
 * the `gh` CLI's token for weeks and how Granola's expired connection looked
 * like a quiet week.
 *
 * A source is now a manifest entry plus a `read` function. The watcher iterates
 * this registry; it knows nothing about Chrome or Linear.
 *
 * Two things this fixes beyond tidiness:
 *
 *   - **Failures are reported, not swallowed.** The old chain wrapped every
 *     branch in one `try { … } catch { return [] }`, so a source that threw
 *     took the whole pass with it and reported nothing at all. Each source now
 *     fails alone and says why.
 *   - **A source declares what it needs.** `requires: 'token'` is checked
 *     before the reader runs, so "not connected" and "broken" stop looking
 *     alike.
 */
import type { Finding } from './local-sources.js'
import type { Provider } from './users.js'

/** What a reader is given. */
export type ReadContext = {
  /** The person's own token, for sources that need one. */
  token?: string
  /** Null when no model is configured, or when this pass asked for rules only. */
  model: import('./llm.js').LlmConfig | null
  /** The short window that makes a pass react to today rather than last quarter. */
  recentDays?: number
  /**
   * Whether credentials already on this machine may be used — the `gh` CLI's
   * token, for someone running this themselves. Never true for a hosted
   * visitor, who must read their own accounts or nothing.
   */
  allowLocalCredentials?: boolean
  /**
   * Whose pass this is, for sources that keep state between passes.
   *
   * A Data Portability archive takes minutes to build, so the job id has to
   * outlive the request that started it — and two people's jobs must not share
   * a file.
   */
  userId?: string
  /**
   * The wallet address this person proved they control, for sources that read
   * a chain. Proven at sign-in, so no further consent is needed to know it —
   * only to read it, which is the grant.
   */
  wallet?: string
}

/** A finding plus how it was produced, which the UI shows and provenance records. */
export type SourceFinding = Finding & { by: 'rules' | 'model'; from: string; host?: string }

export type SourceReader = {
  id: string
  /** The provider whose token this needs, if any. */
  provider?: Provider
  /** `token` sources are skipped without one; `wallet` sources without a proven address. */
  requires: 'token' | 'local' | 'wallet'
  /** Whether this machine can read it at all — a missing browser, no editor. */
  available?: () => boolean
  read: (ctx: ReadContext) => Promise<SourceFinding[]> | SourceFinding[]
}

const READERS = new Map<string, SourceReader>()

export function register(reader: SourceReader): void {
  READERS.set(reader.id, reader)
}

export const reader = (id: string): SourceReader | undefined => READERS.get(id)
export const readers = (): SourceReader[] => [...READERS.values()]

export type ReadOutcome =
  | { id: string; ok: true; findings: SourceFinding[] }
  | { id: string; ok: false; reason: 'not-connected' | 'unavailable' | 'failed'; detail?: string }

/**
 * Run one source.
 *
 * Never throws. A source that fails returns why, so the difference between "you
 * have not connected this", "this machine has no Chrome" and "the token
 * expired" survives all the way to the interface.
 */
export async function readSource(id: string, ctx: ReadContext): Promise<ReadOutcome> {
  const r = READERS.get(id)
  if (!r) return { id, ok: false, reason: 'unavailable', detail: `no reader registered for ${id}` }
  if (r.requires === 'token' && !ctx.token && !ctx.allowLocalCredentials) {
    return { id, ok: false, reason: 'not-connected' }
  }
  if (r.requires === 'wallet' && !ctx.wallet) {
    return { id, ok: false, reason: 'not-connected', detail: 'no wallet has been proven for this person' }
  }
  if (r.available && !r.available()) {
    return { id, ok: false, reason: 'unavailable', detail: 'nothing to read on this machine' }
  }
  try {
    return { id, ok: true, findings: await r.read(ctx) }
  } catch (e) {
    return { id, ok: false, reason: 'failed', detail: e instanceof Error ? e.message : String(e) }
  }
}
