'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * A terminal session, played back line by line.
 *
 * Commands and prompts are typed; tool calls and their results appear whole,
 * as they do in a real session. Reduced motion shows the whole transcript at
 * once. The script is data, so what plays is exactly what was recorded.
 */
export type Line =
  | { kind: 'cmd'; text: string }
  | { kind: 'prompt'; text: string }
  | { kind: 'tool'; text: string }
  | { kind: 'out'; text: string }
  | { kind: 'say'; text: string }
  | { kind: 'gap' }

const TYPE_MS = 22
const PAUSE: Record<Line['kind'], number> = { cmd: 500, prompt: 700, tool: 650, out: 220, say: 900, gap: 300 }

/** `fill`: take the parent's height (wide screens) instead of a fixed one. */
export function Terminal({ script, title = 'terminal', fill = false }: { script: Line[]; title?: string; fill?: boolean }) {
  const [shown, setShown] = useState(0)
  const [typed, setTyped] = useState(0)
  const [done, setDone] = useState(false)
  const [run, setRun] = useState(0)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setShown(script.length); setDone(true); return }
    setShown(0); setTyped(0); setDone(false)
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const step = (i: number, c: number) => {
      if (cancelled) return
      if (i >= script.length) { setDone(true); return }
      const line = script[i]!
      const typing = line.kind === 'cmd' || line.kind === 'prompt'
      if (typing && c < line.text.length) {
        setShown(i); setTyped(c + 1)
        timer = setTimeout(() => step(i, c + 1), TYPE_MS)
        return
      }
      setShown(i + 1); setTyped(0)
      timer = setTimeout(() => step(i + 1, 0), PAUSE[script[i + 1]?.kind ?? 'gap'])
    }
    timer = setTimeout(() => step(0, 0), 400)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [script, run])

  // Scroll the terminal, never the page: scrollIntoView would move the window too.
  useEffect(() => { const el = box.current; if (el) el.scrollTop = el.scrollHeight }, [shown, typed])

  const visible = script.slice(0, shown + (typed ? 1 : 0))
  return (
    <div className={`${fill ? 'flex h-full flex-col' : ''} overflow-hidden rounded-2xl border border-ink/20 bg-[#0e0f11] text-[#e6e6e6] shadow-[0_20px_60px_-30px_rgba(0,0,0,0.6)]`}>
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
        <span className="h-3 w-3 rounded-full bg-white/15" /><span className="h-3 w-3 rounded-full bg-white/15" /><span className="h-3 w-3 rounded-full bg-white/15" />
        <span className="ml-2 font-mono text-[12px] text-white/50">{title}</span>
        <button onClick={() => setRun((r) => r + 1)} className="ml-auto rounded-md px-2 py-0.5 text-[12px] text-white/60 transition-colors hover:bg-white/10 hover:text-white">{done ? 'Replay' : 'Restart'}</button>
      </div>
      <div ref={box} className={`${fill ? 'h-[520px] lg:h-auto lg:min-h-0 lg:flex-1' : 'h-[520px]'} overflow-y-auto p-4 font-mono text-[12.5px] leading-[1.6]`} aria-live="off">
        {visible.map((line, i) => {
          const partial = i === shown && typed ? ('text' in line ? line.text.slice(0, typed) : '') : 'text' in line ? line.text : ''
          const caret = i === shown && typed ? <span className="ml-px inline-block h-[1.1em] w-[7px] translate-y-[3px] bg-white/70" /> : null
          switch (line.kind) {
            case 'gap': return <div key={i} className="h-3" />
            case 'cmd': return <div key={i} className="whitespace-pre-wrap break-all"><span className="text-white/40">$ </span>{partial}{caret}</div>
            case 'prompt': return <div key={i} className="mt-1 whitespace-pre-wrap rounded-md bg-white/[0.06] px-2 py-1"><span className="text-white/40">&gt; </span>{partial}{caret}</div>
            case 'tool': return <div key={i} className="mt-2 whitespace-pre-wrap"><span className="text-white">⏺ </span><span className="font-semibold">{partial}</span></div>
            case 'out': return <div key={i} className="whitespace-pre-wrap pl-4 text-white/55">{partial}</div>
            case 'say': return <div key={i} className="mt-2 whitespace-pre-wrap"><span className="text-white/70">⏺ </span>{partial}</div>
          }
        })}
        {done ? <div className="mt-2"><span className="text-white/40">&gt; </span><span className="inline-block h-[1.1em] w-[7px] translate-y-[3px] animate-pulse bg-white/70" /></div> : null}
      </div>
    </div>
  )
}
