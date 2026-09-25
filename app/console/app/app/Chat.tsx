'use client'

/**
 * Ask your memory, and let it act.
 *
 * The approval step is the visible part of the product's boundary: reads happen
 * while answering, writes stop and wait. Showing the tool and its arguments
 * rather than a summary is deliberate — approving "create_issue on linear"
 * without seeing what it says is not consent.
 */
import { useState } from 'react'

type Pending = { tool: string; server: string; args: Record<string, unknown>; summary: string }
type Answer = { reply: string; called?: { tool: string; ok: boolean }[]; pending?: Pending[]; model?: string | null; error?: string }
type Turn = { role: 'user' | 'assistant'; content: string }

export function Chat({ namespace }: { namespace: string }) {
  const [history, setHistory] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState<Answer | null>(null)
  const [done, setDone] = useState<string[]>([])

  async function send() {
    const message = input.trim()
    if (!message || busy) return
    setBusy(true); setInput(''); setLast(null)
    const next: Turn[] = [...history, { role: 'user', content: message }]
    setHistory(next)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, history }),
      })
      const a = (await res.json()) as Answer
      setLast(a)
      setHistory([...next, { role: 'assistant', content: a.error ?? a.reply }])
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

  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-medium">Ask your memory</h2>
        <p className="font-mono text-[12.5px] text-dim">{namespace}</p>
      </div>
      <p className="mt-1 text-[14px] leading-relaxed text-dim">
        Answers from what your namespaces know, and from the apps you connected. Anything that would
        change something in another app stops here for your approval first.
      </p>

      {history.length ? (
        <div className="mt-4 space-y-3">
          {history.map((t, i) => (
            <div key={i} className={t.role === 'user' ? 'text-right' : ''}>
              <p className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-left text-[13.5px] leading-relaxed ${
                t.role === 'user' ? 'bg-ink text-bg' : 'border border-line bg-raised/40'}`}>
                {t.content}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {last?.called?.length ? (
        <p className="mt-2 text-[12.5px] text-dim">
          read: {last.called.map((c) => `${c.tool}${c.ok ? '' : ' (failed)'}`).join(' · ')}
        </p>
      ) : null}

      {last?.pending?.length ? (
        <div className="mt-3 space-y-2">
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
      ) : null}

      {done.map((d, i) => <p key={i} className="mt-1.5 text-[13px] text-accent">{d}</p>)}

      <div className="mt-4 flex gap-2">
        <input
          value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void send() }}
          placeholder="What am I working on?" disabled={busy}
          className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-[15px] outline-none focus:border-accent/50"
        />
        <button onClick={() => void send()} disabled={busy || !input.trim()}
          className="rounded-lg bg-ink px-4 py-2 text-[15px] font-medium text-bg disabled:opacity-50">
          {busy ? '…' : 'Ask'}
        </button>
      </div>
      {last?.model ? <p className="mt-2 text-[12.5px] text-dim">answered with {last.model}</p> : null}
    </section>
  )
}
