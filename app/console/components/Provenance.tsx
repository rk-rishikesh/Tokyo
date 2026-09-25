import Link from 'next/link'
import type { Knowledge, Provenance as P } from '@recall/core'
import { sourceKind } from '@recall/core'
import { Badge, Mono } from './ui'

const GLYPH: Record<string, string> = { human: '👤', document: '📄', api: '⚡', agent: '🤖', application: '🧩' }

/**
 * "Where did this come from?" — the signature panel (PRD §20): claim, sources
 * as a tree, contributors, review, version, IPFS object. Rendered as a
 * <details> so it is a button that opens in place, no client JS.
 */
export function ProvenancePanel({ k, p, namespace, version, introducedVersion, cid, gatewayUrl, open = false }: {
  k: Knowledge; p: P; namespace: string; version?: number; introducedVersion?: number; cid?: string; gatewayUrl?: string | null; open?: boolean
}) {
  const contributors = [...new Set([k.contributor, ...p.history.map((c) => c.author)])]
  const base = `/k/${encodeURIComponent(namespace)}`
  return (
    <details open={open} className="group rounded-2xl border border-accent/40 bg-accent-soft">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3">
        <span className="text-[15px] font-semibold">Where did this come from?</span>
        <span className="text-[13.5px] text-accent transition-transform group-open:rotate-90">›</span>
      </summary>
      <div className="grid gap-4 border-t border-accent/20 px-5 py-4 text-[15px] md:grid-cols-2">
        <div>
          <p className="text-[12.5px] font-medium uppercase tracking-wider text-muted-foreground">Claim</p>
          <p className="mt-1">{k.subject ? <span className="font-medium">{k.subject}: </span> : null}{k.claim}</p>
          <p className="mt-4 text-[12.5px] font-medium uppercase tracking-wider text-muted-foreground">Sources</p>
          {k.sources.length ? (
            <ul className="mt-1 space-y-1">
              {k.sources.map((s, i) => (
                <li key={i} className="flex gap-2"><span aria-hidden>{GLYPH[sourceKind(s)]}</span><span><span className="font-medium">{s.name ?? s.type}</span>{s.title ? <> — {s.title}</> : null}{s.id ? <> · {s.id.startsWith('http') ? <a href={s.id} target="_blank" rel="noreferrer" className="text-accent hover:underline">link</a> : <Mono>{s.id}</Mono>}</> : null}{s.excerpt ? <p className="text-[13.5px] italic text-muted-foreground">“{s.excerpt}”</p> : null}</span></li>
              ))}
            </ul>
          ) : <p className="mt-1 text-warn">None attached — automated review flags this.</p>}
        </div>
        <div className="space-y-3">
          <div><p className="text-[12.5px] font-medium uppercase tracking-wider text-muted-foreground">Contributors</p><p className="mt-1 font-mono text-[14.5px]">{contributors.join(', ')}</p></div>
          <div><p className="text-[12.5px] font-medium uppercase tracking-wider text-muted-foreground">Review</p><p className="mt-1">{k.reviewers.length ? <><Badge tone="added">verified</Badge> approved by {k.reviewers.length} reviewer{k.reviewers.length === 1 ? '' : 's'}: <span className="font-mono">{k.reviewers.join(', ')}</span></> : <><Badge tone="warn">unreviewed</Badge> committed directly by an owner or reviewer</>}</p></div>
          <div><p className="text-[12.5px] font-medium uppercase tracking-wider text-muted-foreground">Version</p><p className="mt-1">{introducedVersion ? <>introduced in <span className="font-mono">v{introducedVersion}</span></> : 'introduced on a branch'}{version ? <>, current <span className="font-mono">v{version}</span></> : null} · {p.history.length} revision{p.history.length === 1 ? '' : 's'} · confidence {Math.round(k.confidence * 100)}%</p></div>
          <div><p className="text-[12.5px] font-medium uppercase tracking-wider text-muted-foreground">Namespace · IPFS</p><p className="mt-1 break-all font-mono text-[13.5px]"><Link href={base} className="text-accent hover:underline">{namespace}</Link>{cid ? <> · {gatewayUrl ? <a href={gatewayUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">{cid}</a> : cid}</> : <span className="text-muted-foreground"> · not published yet</span>}</p></div>
        </div>
      </div>
    </details>
  )
}
