'use client'

/**
 * How an agent's answer is shown in every chat: the question, the tool calls it
 * made and what each did, the data that came back — fenced, with provenance —
 * and the answer, citing it. The same grammar as the landing page's
 * AgentFetch scene, but driven by what really happened on this request.
 */
import { useEffect, useState } from 'react'

export type TraceCall = {
  /** What the agent called, e.g. knowledge_search, x402_buy, multibaas_read. */
  tool: string
  args: Record<string, string | number>
  /** What the call did, in order. `ok: false` marks the step that failed. */
  steps: { label: string; ok?: boolean }[]
  retrieved?: { source: string; count: number; unit?: string; top?: string; chips?: string[] }
}

export type Citation = { namespace: string; version?: number; subject?: string }

/** A dotted canvas, like the reference, for the conversation to sit on. */
export const CANVAS = { backgroundImage: 'radial-gradient(hsl(var(--ink) / 0.09) 1.2px, transparent 1.2px)', backgroundSize: '24px 24px' } as const

export function UserBubble({ children }: { children: React.ReactNode }) {
  return <div className="ml-auto w-fit max-w-[80%] rounded-[22px] bg-ink px-5 py-3 text-[15.5px] tracking-[-0.01em] text-bg">{children}</div>
}

export function Checking({ busy }: { busy?: boolean }) {
  const [dots, setDots] = useState(1)
  useEffect(() => { if (!busy) return; const t = setInterval(() => setDots((d) => (d % 3) + 1), 450); return () => clearInterval(t) }, [busy])
  return (
    <div className="flex items-center gap-3 text-[15px] text-dim">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-raised text-[15px] text-ink/80" aria-hidden>◈</span>
      {busy ? <span>Checking your knowledge network{'.'.repeat(dots)}</span> : <span>Checked your knowledge network</span>}
    </div>
  )
}

function Check({ state }: { state: 'done' | 'failed' | 'pending' | 'running' }) {
  if (state === 'done') return <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-bg" aria-label="done"><svg viewBox="0 0 16 16" className="h-3.5 w-3.5"><path d="M3.5 8.5 6.5 11.5 12.5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
  if (state === 'failed') return <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-ink/40 text-[12px] font-semibold text-ink/60" aria-label="failed">!</span>
  if (state === 'running') return <span className="h-6 w-6 shrink-0 animate-spin rounded-full border-2 border-line border-t-ink" aria-label="running" />
  return <span className="h-6 w-6 shrink-0 rounded-full border-2 border-line" aria-label="pending" />
}

const fmt = (v: string | number) => (typeof v === 'number' ? String(v) : `"${v}"`)

export function ToolCard({ call, running = -1 }: { call: TraceCall; running?: number }) {
  return (
    <div className="rounded-[22px] border border-line bg-surface p-5 shadow-[0_18px_40px_-28px_hsl(var(--ink)/0.35)]">
      <p className="font-mono text-[15px] text-ink">{call.tool}</p>
      <div className="mt-1.5 space-y-0.5">
        {Object.entries(call.args).map(([k, v]) => <p key={k} className="truncate font-mono text-[13px] text-dim">{k}: {fmt(v)}</p>)}
      </div>
      <ul className="mt-4 space-y-2.5">
        {call.steps.map((s, i) => {
          const state = running >= 0 ? (i < running ? 'done' : i === running ? 'running' : 'pending') : s.ok === false ? 'failed' : 'done'
          return (
            <li key={i} className="flex items-center gap-3">
              <Check state={state} />
              <span className={`text-[14.5px] ${state === 'pending' ? 'text-dim' : 'text-ink'}`}>{s.label}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function Retrieved({ r }: { r: NonNullable<TraceCall['retrieved']> }) {
  const chips = r.chips ?? []
  return (
    <div className="rounded-[22px] border-2 border-dashed border-ink/25 p-5">
      <div className="flex items-baseline justify-between gap-3 text-[12px] uppercase tracking-[0.06em] text-dim">
        <span className="truncate">Retrieved data · <span className="normal-case tracking-normal">{r.source}</span></span>
        <span className="shrink-0 normal-case tracking-normal">{r.count} {r.unit ?? (r.count === 1 ? 'result' : 'results')}</span>
      </div>
      {r.top ? <p className="mt-2 text-[16px] leading-snug tracking-[-0.01em] text-ink">{r.top}</p> : null}
      {chips.length ? <div className="mt-3 flex flex-wrap gap-2">{chips.map((c) => <span key={c} className="rounded-full bg-raised px-2.5 py-1 text-[12.5px] text-ink/70">{c}</span>)}</div> : null}
    </div>
  )
}

/** A call and what came back from it, as one unit. */
export function TraceBlock({ call }: { call: TraceCall }) {
  return <div className="space-y-3"><ToolCard call={call} />{call.retrieved ? <Retrieved r={call.retrieved} /> : null}</div>
}

export function CitedPills({ cites }: { cites: Citation[] }) {
  if (!cites.length) return null
  return (
    <div className="flex flex-wrap gap-2">
      {cites.map((c, i) => (
        <span key={i} className="rounded-full bg-ink px-3.5 py-1.5 text-[12.5px] text-bg">
          cited · {c.namespace}{c.version ? ` v${c.version}` : ''}{c.subject ? ` · ${c.subject}` : ''}
        </span>
      ))}
    </div>
  )
}

/**
 * While the answer is on its way: the calls an agent makes on every read,
 * ticking through. Replaced by the real trace when it arrives.
 */
export function PendingTrace({ namespace, query, tool = 'knowledge_search' }: { namespace: string; query: string; tool?: string }) {
  const steps = [`Resolve ${namespace} on ENS`, 'Read contenthash → refs', 'Fetch commits from IPFS', 'Verify each object by its hash']
  const [i, setI] = useState(0)
  useEffect(() => { const t = setInterval(() => setI((n) => Math.min(n + 1, steps.length - 1)), 900); return () => clearInterval(t) }, [steps.length])
  return (
    <div className="space-y-3">
      <Checking busy />
      <ToolCard call={{ tool, args: { namespace, query }, steps: steps.map((label) => ({ label })) }} running={i} />
    </div>
  )
}

/**
 * Pull `[namespace: subject]` citations out of an answer, so the text reads
 * cleanly and the sources become pills. Anything bracketed that does not name
 * a namespace is left in the text.
 */
export function splitCitations(text: string, versions: Record<string, number> = {}): { text: string; cites: Citation[] } {
  const cites: Citation[] = []
  const seen = new Set<string>()
  const clean = text.replace(/\s*\[([^\]]+)\]/g, (whole, inner: string) => {
    const parts = inner.split(/[;,](?=\s*[a-z0-9-]+(?:\.[a-z0-9-]+)*\.eth\b)/i)
    let used = false
    for (const p of parts) {
      // "ns", "ns: subject", "ns, from source" — and "wallet <label>" for a wallet read.
      const m = p.trim().match(/^([a-z0-9-]+(?:\.[a-z0-9-]+)*\.eth)\s*(?:[:,]\s*(?:from\s+)?(.+))?$/i) ?? p.trim().match(/^wallet\s+(.+)$/i)
      if (!m) continue
      used = true
      const isWallet = /^wallet\s/i.test(p.trim())
      const c: Citation = isWallet ? { namespace: `wallet ${m[1]!.trim()}` } : { namespace: m[1]!.toLowerCase(), ...(versions[m[1]!.toLowerCase()] ? { version: versions[m[1]!.toLowerCase()] } : {}), ...(m[2] ? { subject: m[2].trim() } : {}) }
      const key = `${c.namespace}|${c.subject ?? ''}`
      if (!seen.has(key)) { seen.add(key); cites.push(c) }
    }
    return used ? '' : whole
  })
  return { text: clean, cites }
}

/** The reads behind an answer: the latest is shown open, older ones fold away. */
export function Reads({ trace, open }: { trace: TraceCall[]; open: boolean }) {
  return (
    <details open={open} className="group">
      <summary className="list-none [&::-webkit-details-marker]:hidden">
        <span className="flex cursor-pointer items-center gap-3"><Checking /><span className="text-[12.5px] text-dim group-open:hidden">· {trace.length} read{trace.length === 1 ? '' : 's'}, show</span></span>
      </summary>
      <div className="mt-3 space-y-4">{trace.map((c, i) => <TraceBlock key={i} call={c} />)}</div>
    </details>
  )
}
