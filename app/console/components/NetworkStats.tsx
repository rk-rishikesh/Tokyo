import { defaultBranch, knownNamespaces, loadRepo, snapshotOf, versionOf, type RepoView } from '@/lib/repoview'
import { Stats } from '@/components/ui'

/** What a source type is called in the interface. */
const PRODUCT: Record<string, string> = {
  chrome: 'Browser history',
  editor: 'Editor projects',
  shell: 'Shell history',
  'claude-code': 'Claude Code',
  github: 'GitHub',
  linear: 'Linear',
  granola: 'Granola',
  google: 'Google Workspace',
  human: 'People',
  document: 'Documents',
  api: 'APIs',
  agent: 'Agents',
  application: 'Applications',
  'memory-export': 'Assistant exports',
  wikipedia: 'Wikipedia',
  observation: 'Observations',
}

/**
 * What is actually in the network, counted.
 *
 * The references put a band of numbers under the hero, and they are marketing:
 * "8000+ brands", "26,900,789 visitors engaged". Ours are read from the
 * repositories at request time, which is the only version of this the product
 * can honestly show — a knowledge network asserting an unverifiable number
 * about itself would be arguing against its own point.
 *
 * It renders nothing when there is nothing, rather than showing three zeroes.
 *
 * Deliberately not cached: a count baked at build time would be a number that
 * looks live and is not, which is the same dishonesty in a slower form.
 */
export const dynamic = 'force-dynamic'

export async function NetworkStats() {
  const names = knownNamespaces()
  const views = (await Promise.all(names.map((n) => loadRepo(n).catch(() => null)))).filter((v): v is RepoView => !!v)
  if (!views.length) return null

  let claims = 0
  let versions = 0
  const sources = new Set<string>()
  const products = new Set<string>()
  for (const v of views) {
    const branch = defaultBranch(v)
    versions += versionOf(v, branch)
    for (const k of Object.values(snapshotOf(v, branch))) {
      claims++
      for (const s of k.sources) {
        sources.add(s.name ?? s.type)
        // A source's `name` is often the citation — a file, a section, a URL.
        // The row wants what a person would recognise, which is the product it
        // came through, so a claim citing `CONTRACTS.md §7` reads as the
        // document it is rather than a path nobody outside the repo knows.
        // Only types we have a name for. An unmapped one is a legacy or
        // one-off citation kind — `prd`, `conversation`, `repo` — and showing
        // it raw makes the row read as debug output rather than a product.
        const named = PRODUCT[s.type]
        if (named) products.add(named)
      }
    }
  }
  if (!claims) return null

  // The references follow a band of numbers with one enormous figure — the
  // move that makes a claim land. Ours is the count of claims anyone can go and
  // read, which is the only number here we can stand behind.
  return (
    <div className="space-y-8">
      <Stats
        items={[
          { value: claims.toLocaleString(), label: 'claims', hint: `across ${views.length} namespace${views.length === 1 ? '' : 's'}` },
          { value: sources.size.toLocaleString(), label: 'distinct sources cited', hint: 'every claim names where it came from' },
          { value: versions.toLocaleString(), label: 'versions committed', hint: 'each one reviewable and revertible' },
        ]}
      />
      <div className="border-t border-line pt-6">
        <p className="text-[12.5px] text-dim">Sources behind these claims</p>
        <div className="mt-4 flex flex-wrap items-center gap-x-7 gap-y-3">
          {[...products].slice(0, 9).map((s) => (
            <span key={s} className="text-[13.5px] font-medium text-dim">{s}</span>
          ))}
        </div>
        <p className="mt-5 text-[14px] leading-relaxed text-dim">
          Not a logo wall. Every name here wrote at least one claim you can open, and every claim still says which.
        </p>
      </div>
    </div>
  )
}
