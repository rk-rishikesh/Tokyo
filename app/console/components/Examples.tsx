'use client'

import { useState } from 'react'
import { EXAMPLES } from '@/content/copy'

/** Three ways in — CLI, agent, browser — as real transcripts, one at a time. */
export function Examples() {
  const [active, setActive] = useState(EXAMPLES[0]!.id)
  const ex = EXAMPLES.find((e) => e.id === active)!
  return (
    <div className="rounded-2xl border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-1 border-b border-line px-3 pt-3">
        {EXAMPLES.map((e) => (
          <button
            key={e.id}
            onClick={() => setActive(e.id)}
            aria-pressed={e.id === active}
            className={`-mb-px rounded-t-md border-b-2 px-3 py-2 text-[15px] transition-colors ${e.id === active ? 'border-accent text-ink' : 'border-transparent text-dim hover:text-ink'}`}
          >
            {e.label}
          </button>
        ))}
        <span className="ml-auto pb-2 pr-1 text-[13.5px] text-dim">{ex.intro}</span>
      </div>
      <div className="border-b border-line px-5 py-4">
        <p className="mb-2 text-[12.5px] uppercase tracking-wide text-dim">Install</p>
        <pre className="overflow-x-auto font-mono text-[14px] leading-relaxed text-ink/90"><code>{ex.install}</code></pre>
      </div>
      <pre className="overflow-x-auto p-5 font-mono text-[14px] leading-relaxed text-ink/90"><code>{ex.code}</code></pre>
    </div>
  )
}
