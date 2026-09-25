/**
 * A real source integration, kept deliberately small: Wikipedia's public REST
 * summary endpoint → sentences → claims → one proposal.
 *
 * This is the PRD's "Documents / Applications" ingestion in miniature. Nothing
 * lands on the namespace by itself — the import is a proposal like any other,
 * runs through the same automated review, and is attributed to the connected
 * source's contributor identity so readers can see "Source: Wikipedia".
 */
import type { Knowledge, Proposal, Source } from '@knowledge01/core'
import type { Repository } from '@knowledge01/repo'

type Summary = { title: string; extract: string; content_urls?: { desktop?: { page?: string } }; description?: string }

export async function fetchWikipediaSummary(title: string): Promise<Summary> {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`
  const res = await fetch(url, { headers: { 'user-agent': 'knowledge-network-demo/0.1 (Sepolia; ENSv2)' } })
  if (!res.ok) throw new Error(`Wikipedia returned ${res.status} for "${title}"`)
  return (await res.json()) as Summary
}

/** Split an extract into declarative sentences worth keeping as claims. */
export function sentences(extract: string, limit: number): string[] {
  return extract
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 30 && s.length < 400 && !/^(See also|References)/.test(s))
    .slice(0, limit)
}

export async function importWikipedia(
  repo: Repository,
  title: string,
  opts: { topic?: string | null; subject?: string; limit?: number } = {},
): Promise<{ proposal: Proposal; items: Knowledge[]; source: Source }> {
  const summary = await fetchWikipediaSummary(title)
  const pageUrl = summary.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(summary.title.replace(/ /g, '_'))}`
  const connection = repo.sources().find((c) => c.name.toLowerCase() === 'wikipedia')
  const contributor = connection?.contributor ?? 'wikipedia-import'
  const source: Source = { type: 'wikipedia', kind: 'application', name: 'Wikipedia', title: summary.title, id: pageUrl }
  const claims = sentences(summary.extract, opts.limit ?? 6)
  if (!claims.length) throw new Error(`no usable sentences in the summary of "${summary.title}"`)

  const prev = repo.branch
  const branch = `import/wikipedia-${summary.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}-${Date.now().toString(36)}`
  repo.checkout(branch, { create: true })
  try {
    const items = claims.map((claim) => repo.add({
      claim, subject: opts.subject ?? summary.title, topic: opts.topic ?? null, type: 'fact', confidence: 0.75,
      sources: [{ ...source, excerpt: claim }], contributor,
    }))
    repo.commit(`Import from Wikipedia: ${summary.title}`, { author: contributor })
    const proposal = repo.propose({ title: `Import from Wikipedia: ${summary.title}`, description: `${claims.length} claims from the Wikipedia summary of “${summary.title}”${summary.description ? ` (${summary.description})` : ''}. Source: ${pageUrl}`, branch })
    return { proposal, items, source }
  } finally {
    repo.checkout(prev)
  }
}
