import Link from 'next/link'
import type { Knowledge } from '@knowledge01/core'
import { sourceKind } from '@knowledge01/core'
import { Badge, Mono } from './ui'
import { Arrow } from '@/components/Arrow'

export function Confidence({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  return (
    <span className="inline-flex items-center gap-1.5 text-[13.5px] text-muted-foreground" title={`confidence ${pct}%`}>
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-muted"><span className="block h-full bg-accent" style={{ width: `${pct}%` }} /></span>{pct}%
    </span>
  )
}

export function SourceList({ sources }: { sources: Knowledge['sources'] }) {
  if (!sources.length) return <span className="text-[13.5px] text-warn">no sources</span>
  return (
    <ul className="space-y-0.5 text-[13.5px] text-muted-foreground">
      {sources.map((s, i) => (
        <li key={i}>
          <span aria-hidden>{({ human: '👤', document: '📄', api: '⚡', agent: '🤖', application: '🧩' } as Record<string, string>)[sourceKind(s)]}</span>{' '}<span className="rounded bg-muted px-1 font-mono text-[12px] uppercase">{s.name ?? s.type}</span>{' '}
          {s.id?.startsWith('http') ? <a href={s.id} target="_blank" rel="noreferrer" className="text-accent hover:underline">{s.title ?? s.id}</a> : <span>{s.title ?? s.id ?? ''}</span>}
          {s.id && !s.id.startsWith('http') && s.title ? <span className="ml-1 font-mono text-[12.5px]">{s.id}</span> : null}
          {s.excerpt ? <span className="ml-1 italic">“{s.excerpt}”</span> : null}
        </li>
      ))}
    </ul>
  )
}

export function KnowledgeCard({ k, namespace, branch, compact = false }: { k: Knowledge; namespace: string; branch: string; compact?: boolean }) {
  const href = `/k/${encodeURIComponent(namespace)}/item/${encodeURIComponent(k.id)}?branch=${encodeURIComponent(branch)}`
  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {k.subject ? <p className="text-[13.5px] font-medium text-muted-foreground">{k.subject}</p> : null}
          <p className="max-w-3xl text-[15px] leading-relaxed">{k.claim}</p>
        </div>
        <Link href={href} className="shrink-0 text-[13.5px] text-accent hover:underline">provenance <Arrow /></Link>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge tone="accent">{k.type}</Badge>
        {k.topic ? <Badge>{k.topic}</Badge> : null}
        {k.reviewers.length ? <Badge tone="added">verified · {k.reviewers.join(', ')}</Badge> : <Badge tone="warn">unreviewed</Badge>}
        <Confidence value={k.confidence} />
        <span className="text-[13.5px] text-muted-foreground">· {k.contributor} · {k.created_at.slice(0, 10)}</span>
        <span className="ml-auto"><Mono>{k.id}</Mono></span>
      </div>
      {!compact ? <div className="mt-2"><SourceList sources={k.sources} /></div> : null}
    </article>
  )
}
