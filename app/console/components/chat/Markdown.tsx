/**
 * The Markdown a model writes, rendered as React elements — never as HTML, so
 * nothing in an answer can inject markup. Covers what chat answers use:
 * headings, paragraphs, bulleted and numbered lists, quotes, fenced code, and
 * inline bold, italics, code and http(s) links. Anything else stays as text.
 */
import { Fragment, type ReactNode } from 'react'

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_|\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g

function inline(text: string, key = 'i'): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0
    if (at > last) out.push(text.slice(last, at))
    const t = m[0]
    const k = `${key}-${at}`
    if (t.startsWith('`')) out.push(<code key={k} className="rounded bg-raised px-1 py-0.5 font-mono text-[0.88em]">{t.slice(1, -1)}</code>)
    else if (t.startsWith('**') || t.startsWith('__')) out.push(<strong key={k} className="font-semibold">{inline(t.slice(2, -2), k)}</strong>)
    else if (t.startsWith('[')) {
      const label = t.slice(1, t.indexOf(']('))
      out.push(<a key={k} href={m[2]} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-ink">{inline(label, k)}</a>)
    } else out.push(<em key={k}>{inline(t.slice(1, -1), k)}</em>)
    last = at + t.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

type Block =
  | { kind: 'h'; level: number; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'ul' | 'ol'; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'code'; text: string }

function blocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  const out: Block[] = []
  let para: string[] = []
  const flush = () => { if (para.length) { out.push({ kind: 'p', text: para.join(' ') }); para = [] } }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const t = line.trim()
    if (t.startsWith('```')) {
      flush()
      const code: string[] = []
      while (++i < lines.length && !lines[i]!.trim().startsWith('```')) code.push(lines[i]!)
      out.push({ kind: 'code', text: code.join('\n') })
      continue
    }
    if (!t) { flush(); continue }
    const h = t.match(/^(#{1,4})\s+(.*)$/)
    if (h) { flush(); out.push({ kind: 'h', level: h[1]!.length, text: h[2]! }); continue }
    const ul = t.match(/^[-*•]\s+(.*)$/)
    const ol = t.match(/^\d+[.)]\s+(.*)$/)
    if (ul || ol) {
      flush()
      const kind = ul ? 'ul' : 'ol'
      const prev = out[out.length - 1]
      if (prev && prev.kind === kind) prev.items.push((ul ?? ol)![1]!)
      else out.push({ kind, items: [(ul ?? ol)![1]!] })
      continue
    }
    if (t.startsWith('>')) { flush(); out.push({ kind: 'quote', text: t.replace(/^>\s?/, '') }); continue }
    para.push(t)
  }
  flush()
  return out
}

export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  return (
    <div className={`space-y-3 text-[15.5px] leading-relaxed tracking-[-0.005em] ${className}`}>
      {blocks(text).map((b, i) => {
        const k = `b${i}`
        switch (b.kind) {
          case 'h': return <p key={k} className={b.level <= 2 ? 'pt-1 text-[17px] font-semibold tracking-[-0.01em]' : 'pt-1 text-[12.5px] font-medium uppercase tracking-[0.08em] text-dim'}>{inline(b.text, k)}</p>
          case 'p': return <p key={k}>{inline(b.text, k)}</p>
          case 'quote': return <p key={k} className="border-l-2 border-line pl-3 text-dim">{inline(b.text, k)}</p>
          case 'code': return <pre key={k} className="overflow-x-auto rounded-xl bg-raised p-3 font-mono text-[13px] leading-snug"><code>{b.text}</code></pre>
          case 'ul':
          case 'ol': {
            const Tag = b.kind === 'ul' ? 'ul' : 'ol'
            return (
              <Tag key={k} className={`space-y-1.5 pl-5 ${b.kind === 'ul' ? 'list-disc marker:text-dim' : 'list-decimal marker:text-dim'}`}>
                {b.items.map((it, j) => <li key={j} className="pl-1">{inline(it, `${k}-${j}`)}</li>)}
              </Tag>
            )
          }
        }
        return <Fragment key={k} />
      })}
    </div>
  )
}
