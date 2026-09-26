/** Numbered steps, one after another: how the demos explain a flow. */
/** `row`: side by side on wide screens, for a flow of a few steps. */
export function Steps({ children, className = '', row = false }: { children: React.ReactNode; className?: string; row?: boolean }) {
  return <ol className={`${row ? 'grid gap-7 lg:grid-cols-3 lg:gap-8' : 'space-y-7'} ${className}`}>{children}</ol>
}

export function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-[13px] font-semibold text-bg">{n}</span>
      <div className="min-w-0 flex-1 space-y-3 text-[14.5px] leading-relaxed text-dim">
        <h3 className="text-[16px] font-semibold text-ink">{title}</h3>
        {children}
      </div>
    </li>
  )
}

/** Small live facts under a step. */
export function Chips({ items }: { items: (string | null | undefined)[] }) {
  return <div className="flex flex-wrap gap-1.5">{items.filter(Boolean).map((c) => <span key={c} className="rounded-full bg-raised px-2.5 py-1 text-[12px] text-ink/75">{c}</span>)}</div>
}
