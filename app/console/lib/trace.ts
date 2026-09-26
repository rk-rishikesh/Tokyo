/**
 * What an agent read while answering, as the chat shows it: one card per call,
 * with the claim that best matches the question pulled out of what came back.
 *
 * Built from the reads that really happened on the request — the namespace,
 * its version, the grant a paid read used — never from a script.
 */
import type { TraceCall } from '@/components/chat/AgentTrace'

type ClaimLike = { id?: string; subject: string | null; claim: string; topic: string | null; sources?: string[]; contributor?: string; confidence?: number }

const STOP = new Set(['what', 'which', 'where', 'when', 'with', 'from', 'that', 'this', 'have', 'does', 'will', 'your', 'mine', 'about', 'there', 'their', 'into', 'could', 'should', 'would', 'give', 'show', 'tell', 'much', 'many', 'last', 'days'])
const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9$%.]{3,}/g)?.filter((w) => !STOP.has(w)) ?? [])

/** Claims ranked by how many of the question's words they share. */
export function rank<T extends ClaimLike>(claims: T[], question: string): { hits: T[]; best: T | null } {
  const q = words(question)
  const scored = claims.map((c) => {
    const w = words(`${c.subject ?? ''} ${c.topic ?? ''} ${c.claim}`)
    let n = 0; for (const x of q) if (w.has(x) || [...w].some((y) => y.startsWith(x) || x.startsWith(y))) n++
    return { c, n }
  }).sort((a, b) => b.n - a.n)
  const hits = scored.filter((s) => s.n > 0).map((s) => s.c)
  return { hits, best: scored[0]?.c ?? null }
}

const pct = (n?: number) => (n === undefined ? null : `${Math.round(n * 100)}%`)
const sourceLabel = (s?: string) => (s ? s.replace(/^[a-z]+:\s*/i, '').slice(0, 36) : null)

function chipsOf(c: ClaimLike, more: number): string[] {
  return [c.topic, sourceLabel(c.sources?.[0]), pct(c.confidence), c.contributor, more > 0 ? `+${more} more` : null].filter((x): x is string => !!x)
}

/** A read of one namespace: resolve on ENS, fetch from IPFS, verify, then search. */
export function namespaceRead(o: { namespace: string; version: number; claims: ClaimLike[]; question: string; sealed?: 'grant' | 'key' | false; tool?: string }): TraceCall {
  const { hits, best } = rank(o.claims, o.question)
  const shown = hits.length ? hits : o.claims
  return {
    tool: o.tool ?? 'knowledge_search',
    args: { namespace: o.namespace, query: o.question.slice(0, 80) },
    steps: [
      { label: `Resolve ${o.namespace} on ENS` },
      { label: `Read contenthash → refs, v${o.version}` },
      ...(o.sealed === 'grant' ? [{ label: 'Unseal the key from its own grant' }] : o.sealed === 'key' ? [{ label: 'Decrypt with the namespace key' }] : []),
      { label: 'Fetch commits from IPFS' },
      { label: 'Verify each object by its hash' },
    ],
    retrieved: {
      source: `${o.namespace} v${o.version}`,
      count: shown.length,
      ...(best ? { top: best.claim, chips: chipsOf(best, Math.max(0, shown.length - 1)) } : {}),
    },
  }
}

/** Buying read access over x402, then reading with the buyer's own key. */
export function paidRead(o: { namespace: string; version: number; claims: ClaimLike[]; question: string; price: string; network: string; tx: string | null; validUntil: string | null }): TraceCall {
  const { hits, best } = rank(o.claims, o.question)
  const shown = hits.length ? hits : o.claims
  const until = o.validUntil ? new Date(o.validUntil).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'the epoch ends'
  return {
    tool: 'x402_pay',
    args: { namespace: o.namespace, price: `${o.price} USDC`, network: o.network },
    steps: [
      { label: `Read the offer from ${o.namespace}'s access manifest` },
      { label: `Pay Agent A over x402${o.tx ? ` · ${o.tx.slice(0, 10)}…` : ''}` },
      { label: `Grant sealed to Agent B's key, until ${until}` },
      { label: `Decrypt v${o.version} with Agent B's own key` },
    ],
    retrieved: { source: `${o.namespace} v${o.version}`, count: shown.length, ...(best ? { top: best.claim, chips: chipsOf(best, Math.max(0, shown.length - 1)) } : {}) },
  }
}
