/**
 * One glyph per source kind.
 *
 * Two pages had their own copy of this map. They happened to agree, which is
 * the only reason nobody noticed — the provider label maps beside them had
 * already drifted, with Google rendered as 🅖 in one place and 🔴 in another.
 */
import type { SourceKind } from '@knowledge01/core'

export const SOURCE_GLYPH: Record<SourceKind, string> = {
  human: '👤',
  document: '📄',
  api: '⚡',
  agent: '🤖',
  application: '🧩',
}
