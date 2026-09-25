import Link from 'next/link'
import type { Commit } from '@recall/core'
import { Badge, Mono } from './ui'

export function CommitRow({ c, namespace, isHead, version, proposalNumber, cid, gatewayUrl }: { c: Commit; namespace: string; isHead?: boolean; version?: number; proposalNumber?: number; cid?: string; gatewayUrl?: string | null }) {
  const base = `/k/${encodeURIComponent(namespace)}`
  const parent = c.parents[0]
  const diffHref = parent ? `${base}/diff?from=${parent}&to=${c.id}` : `${base}/diff?to=${c.id}`
  return (
    <li className="flex gap-4 py-3">
      <div className="flex flex-col items-center">
        <span className={`mt-1.5 h-2.5 w-2.5 rounded-full ${isHead ? 'bg-accent' : 'bg-border'}`} />
        <span className="mt-1 w-px flex-1 bg-border" />
      </div>
      <div className="min-w-0 flex-1 pb-2">
        <div className="flex flex-wrap items-center gap-2">
          {version ? <span className="font-mono text-[15px] font-semibold">v{version}</span> : null}
          <Link href={diffHref} className="font-mono text-[15px] text-accent hover:underline">{c.id.slice(0, 7)}</Link>
          <span className="text-[15px] font-medium">{c.message}</span>
          {isHead ? <Badge tone="accent">current</Badge> : null}
          {c.proposal ? <Link href={`${base}/reviews/${proposalNumber ?? ''}`}><Badge tone="added">via review{proposalNumber ? ` #${proposalNumber}` : ''}</Badge></Link> : null}
          {c.parents.length > 1 && !c.proposal ? <Badge>merge</Badge> : null}
          {c.message.startsWith('Revert') ? <Badge tone="warn">revert</Badge> : null}
        </div>
        <p className="mt-1 text-[13.5px] text-muted-foreground">
          {c.author} · {c.timestamp.replace('T', ' ').slice(0, 19)} · on {c.branch} ·{' '}
          <span className="text-added">+{c.changes.added.length}</span> <span className="text-warn">~{c.changes.updated.length}</span> <span className="text-removed">-{c.changes.removed.length}</span>
        </p>
        {cid ? (
          <p className="mt-1 text-[13.5px] text-muted-foreground">object {gatewayUrl ? <a className="font-mono text-accent hover:underline" href={gatewayUrl} target="_blank" rel="noreferrer">{cid}</a> : <Mono>{cid}</Mono>}</p>
        ) : null}
      </div>
    </li>
  )
}
