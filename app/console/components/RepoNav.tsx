import Link from 'next/link'

export type RepoTab = 'knowledge' | 'branches' | 'contributors' | 'history' | 'reviews' | 'findings' | 'diff'

/** GitHub + Wikipedia: one namespace, six tabs. Branch is carried in the query so every tab agrees. */
export function RepoNav({ namespace, active, branch, counts }: { namespace: string; active: RepoTab; branch?: string; counts?: Partial<Record<RepoTab, number>> }) {
  const base = `/k/${encodeURIComponent(namespace)}`
  const q = branch ? `?branch=${encodeURIComponent(branch)}` : ''
  const tabs: { key: RepoTab; href: string; label: string }[] = [
    { key: 'knowledge', href: `${base}${q}`, label: 'Knowledge' },
    { key: 'branches', href: `${base}/branches`, label: 'Branches' },
    { key: 'contributors', href: `${base}/contributors${q}`, label: 'Contributors' },
    { key: 'history', href: `${base}/history${q}`, label: 'History' },
    { key: 'reviews', href: `${base}/reviews`, label: 'Reviews' },
    { key: 'findings', href: `${base}/findings`, label: 'Findings' },
    { key: 'diff', href: `${base}/diff`, label: 'Diff' },
  ]
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} className={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-[15px] transition-colors ${t.key === active ? 'border-accent text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
          {t.label}{counts?.[t.key] !== undefined ? <span className="rounded-full bg-muted px-1.5 text-[12.5px] text-muted-foreground">{counts[t.key]}</span> : null}
        </Link>
      ))}
    </nav>
  )
}
