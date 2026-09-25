import type { SnapshotDiff, Knowledge as Memory } from '@k01/core'
import { Badge, Mono } from './ui'

const show = (v: unknown) => (Array.isArray(v) ? v.join(', ') : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '—'))

function Row({ sign, m, children }: { sign: '+' | '-' | '~'; m: Memory; children?: React.ReactNode }) {
  const tone = sign === '+' ? 'border-added/40 bg-added-bg' : sign === '-' ? 'border-removed/40 bg-removed-bg' : 'border-warn/40 bg-warn-bg'
  const mark = sign === '+' ? 'text-added' : sign === '-' ? 'text-removed' : 'text-warn'
  return (
    <div className={`rounded-md border p-3 ${tone}`}>
      <div className="flex items-start gap-3">
        <span className={`font-mono text-[15px] font-bold ${mark}`}>{sign}</span>
        <div className="min-w-0 flex-1">
          <p className={`text-[15px] ${sign === '-' ? 'line-through opacity-70' : ''}`}>{m.subject ? <span className="mr-1 text-[13.5px] text-muted-foreground">{m.subject} —</span> : null}{m.claim}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Badge>{m.type}</Badge>{m.topic ? <Badge>{m.topic}</Badge> : null}<span className="text-[13.5px] text-muted-foreground">{m.sources.length} source{m.sources.length === 1 ? '' : 's'}</span>
            <span className="text-[13.5px] text-muted-foreground">{Math.round(m.confidence * 100)}%</span>
            <Mono>{m.id}</Mono>
          </div>
          {children}
        </div>
      </div>
    </div>
  )
}

export function DiffView({ diff }: { diff: SnapshotDiff }) {
  if (!diff.changes.length) return <p className="text-[15px] text-muted-foreground">No differences — the two snapshots hold the same memories.</p>
  return (
    <div className="space-y-2">
      <p className="text-[13.5px] text-muted-foreground">
        <span className="text-added">+{diff.added} added</span> · <span className="text-warn">~{diff.changed} changed</span> · <span className="text-removed">-{diff.removed} removed</span>
      </p>
      {diff.changes.map((c) => {
        if (c.kind === 'added') return <Row key={`a${c.id}`} sign="+" m={c.after} />
        if (c.kind === 'removed') return <Row key={`r${c.id}`} sign="-" m={c.before} />
        return (
          <Row key={`c${c.id}`} sign="~" m={c.after}>
            <dl className="mt-2 space-y-1 border-l-2 border-warn/40 pl-3 text-[13.5px]">
              {c.fields.map((f) => (
                <div key={String(f.field)} className="grid gap-x-3 sm:grid-cols-[6rem_1fr_1fr]">
                  <dt className="font-mono text-muted-foreground">{String(f.field)}</dt>
                  <dd className="text-removed line-through">{show(f.before)}</dd>
                  <dd className="text-added">{show(f.after)}</dd>
                </div>
              ))}
            </dl>
          </Row>
        )
      })}
    </div>
  )
}
