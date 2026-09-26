'use client'

/**
 * Ask your memory, and let it act.
 *
 * The approval step is the visible part of the product's boundary: reads happen
 * while answering, writes stop and wait. Showing the tool and its arguments
 * rather than a summary is deliberate — approving "create_issue on linear"
 * without seeing what it says is not consent.
 */
import { useEffect, useRef, useState } from 'react'
import { Markdown } from '@/components/chat/Markdown'
import { CANVAS, CitedPills, PendingTrace, Reads, splitCitations, UserBubble, type TraceCall } from '@/components/chat/AgentTrace'

type Pending = { tool: string; server: string; args: Record<string, unknown>; summary: string }
type Answer = { reply: string; called?: { tool: string; ok: boolean }[]; pending?: Pending[]; model?: string | null; error?: string; trace?: TraceCall[]; versions?: Record<string, number> }
type Turn = { role: 'user' | 'assistant'; content: string; trace?: TraceCall[]; versions?: Record<string, number> }

/**
 * `onActive` tells the workspace a conversation has started, so the pipeline
 * above can step aside and the chat can have the height.
 */
export function Chat({ namespace, onActive }: { namespace: string; onActive?: (active: boolean) => void }) {
  const [history, setHistory] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState<Answer | null>(null)
  const [done, setDone] = useState<string[]>([])
  const end = useRef<HTMLDivElement>(null)
  const active = history.length > 0
  useEffect(() => { onActive?.(active) }, [active, onActive])
  useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }) }, [history.length, busy, last])
  const reset = () => { setHistory([]); setLast(null); setDone([]); setInput('') }

  async function send() {
    const message = input.trim()
    if (!message || busy) return
    setBusy(true); setInput(''); setLast(null)
    const next: Turn[] = [...history, { role: 'user', content: message }]
    const sent = history.map(({ role, content }) => ({ role, content }))
    setHistory(next)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, history: sent }),
      })
      const a = (await res.json()) as Answer
      setLast(a)
      setHistory([...next, { role: 'assistant', content: a.error ?? a.reply, ...(a.trace ? { trace: a.trace } : {}), ...(a.versions ? { versions: a.versions } : {}) }])
    } catch {
      setHistory([...next, { role: 'assistant', content: 'that did not go through' }])
    } finally { setBusy(false) }
  }

  async function run(p: Pending) {
    setBusy(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ approve: p }),
      })
      const out = (await res.json()) as { ok: boolean; text: string }
      setDone((d) => [...d, `${p.tool}: ${out.ok ? 'done' : out.text}`])
      setLast((l) => (l ? { ...l, pending: (l.pending ?? []).filter((x) => x !== p) } : l))
    } finally { setBusy(false) }
  }

  const pending = last?.pending?.length ? (
    <div className="space-y-2">
      {last.pending.map((p, i) => (
        <div key={i} className="rounded-xl border border-accent/45 bg-accent-soft p-3">
          <p className="text-[14px] font-medium">This would change something in {p.server}</p>
          <pre className="mt-1.5 overflow-x-auto rounded-lg bg-bg/60 p-2 text-[12.5px] leading-snug">
{p.tool}({JSON.stringify(p.args, null, 2)})
          </pre>
          <div className="mt-2 flex gap-2">
            <button onClick={() => void run(p)} disabled={busy}
              className="rounded-lg bg-ink px-3 py-1.5 text-[13.5px] font-medium text-bg disabled:opacity-50">Approve</button>
            <button onClick={() => setLast((l) => (l ? { ...l, pending: (l.pending ?? []).filter((x) => x !== p) } : l))}
              className="rounded-lg border border-line px-3 py-1.5 text-[13.5px]">Discard</button>
          </div>
        </div>
      ))}
    </div>
  ) : null

  return (
    <div className={`flex min-h-0 flex-col ${active ? 'flex-1' : ''}`}>
      {active ? (
        // The conversation, on the dotted canvas the pipeline sat on.
        <div className="min-h-0 flex-1 overflow-y-auto" style={CANVAS}>
          <div className="mx-auto w-full max-w-[860px] space-y-5 px-4 py-8">
            {history.map((t, i) => t.role === 'user' ? <UserBubble key={i}>{t.content}</UserBubble> : (
              <div key={i} className="space-y-4">
                {t.trace?.length ? <Reads trace={t.trace} open={i === history.length - 1} /> : null}
                <Said text={t.content} versions={t.versions} />
              </div>
            ))}
            {busy && history.at(-1)?.role === 'user' ? <PendingTrace namespace={namespace} query={history.at(-1)!.content} /> : null}
            {pending}
            {done.map((d, i) => <p key={i} className="text-[13px] text-accent">{d}</p>)}
            <div ref={end} />
          </div>
        </div>
      ) : null}

      <div className="mx-auto w-full max-w-[860px] shrink-0 px-4 pb-4 pt-3">
        {active ? null : (
          <div className="mb-3 px-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[15px] font-medium">Ask your memory</h2>
              <p className="font-mono text-[12.5px] text-dim">{namespace}</p>
            </div>
            <p className="mt-1 text-[14px] leading-relaxed text-dim">
              Answers from what your namespaces know, and from the apps you connected. Anything that would
              change something in another app stops here for your approval first.
            </p>
          </div>
        )}
        <form onSubmit={(e) => { e.preventDefault(); void send() }}
          className="flex items-center gap-2 rounded-2xl border border-line bg-surface p-2 shadow-[0_18px_40px_-28px_hsl(var(--ink)/0.45)] focus-within:border-ink/30">
          <input
            value={input} onChange={(e) => setInput(e.target.value)}
            placeholder="What am I working on?" disabled={busy} aria-label="Ask your memory"
            className="min-w-0 flex-1 bg-transparent px-3 py-2 text-[15px] outline-none placeholder:text-dim"
          />
          <button disabled={busy || !input.trim()}
            className="rounded-xl bg-ink px-4 py-2 text-[14.5px] font-medium text-bg disabled:opacity-40">
            {busy ? '…' : 'Ask'}
          </button>
        </form>
        {active ? (
          <div className="mt-2 flex items-center justify-between px-1 text-[12.5px] text-dim">
            <span>{last?.model ? `answered with ${last.model} · ${namespace}` : namespace}</span>
            <button type="button" onClick={reset} disabled={busy} className="hover:text-ink disabled:opacity-50">New chat · show pipeline</button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** An answer, with its [namespace] citations lifted into pills under it. */
function Said({ text, versions }: { text: string; versions?: Record<string, number> }) {
  const { text: clean, cites } = splitCitations(text, versions)
  return (
    <div className="space-y-3">
      <Markdown text={clean.trim()} />
      <CitedPills cites={cites} />
    </div>
  )
}
