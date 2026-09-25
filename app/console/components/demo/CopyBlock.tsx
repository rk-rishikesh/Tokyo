'use client'

import { useState } from 'react'

/** A command or prompt to copy into your own terminal. */
export function CopyBlock({ text, prompt = false }: { text: string; prompt?: boolean }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* clipboard blocked */ }
  }
  return (
    <div className="group relative rounded-xl border border-line bg-raised/50">
      <pre className={`overflow-x-auto whitespace-pre-wrap break-words p-3 pr-16 text-[13px] leading-relaxed ${prompt ? 'font-sans' : 'font-mono'}`}>{prompt ? <span className="text-dim">&gt; </span> : <span className="text-dim">$ </span>}{text}</pre>
      <button onClick={copy} className="absolute right-2 top-2 rounded-md border border-line bg-surface px-2 py-0.5 text-[12px] text-dim transition-colors hover:text-ink">{copied ? 'Copied' : 'Copy'}</button>
    </div>
  )
}
