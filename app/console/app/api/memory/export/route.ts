/**
 * Download your memory.
 *
 * Two shapes of the same thing. JSON is complete — every claim with its
 * sources, confidence and provenance, and every version with what it changed —
 * so another tool can import it without asking us anything. Markdown is the
 * same claims written for a person to read.
 *
 * Built from the owner's namespaces on this machine, decrypted — which is the
 * point of a download. It is only ever served to the signed-in owner.
 */
import { namespacesOf, pendingOf } from '@k01/connect'
import { Repository } from '@k01/repo'
import { ownerOf, viewer } from '@/lib/session'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const owner = ownerOf(await viewer())
  if (!owner) return new Response('sign in first', { status: 401 })
  const format = new URL(req.url).searchParams.get('format') === 'md' ? 'md' : 'json'

  const onChain = new Map((await pendingOf(owner).catch(() => [])).map((p) => [p.namespace, p.onChain?.version ?? null]))
  const namespaces = namespacesOf(owner).map((name) => {
    const repo = Repository.open(name)
    const line = repo.log(repo.refs.head, 10_000)
    const head = line[0]
    return {
      namespace: name,
      version: line.length,
      onChainVersion: onChain.get(name) ?? null,
      encrypted: repo.policy.readers !== 'public',
      claims: Object.values(head?.snapshot ?? {}),
      history: line.map((c, i) => ({
        version: line.length - i,
        commit: c.id,
        at: c.timestamp,
        author: c.author,
        message: c.message,
        changes: c.changes,
        ...(c.proposal ? { proposal: c.proposal } : {}),
      })),
    }
  })
  const stamp = new Date().toISOString()
  const file = `${owner}-memory-${stamp.slice(0, 10)}`

  if (format === 'json') {
    const body = JSON.stringify({ kind: 'knowledge-export', version: 1, owner, exportedAt: stamp, namespaces }, null, 2)
    return new Response(body, { headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="${file}.json"`, 'cache-control': 'no-store' } })
  }

  const md: string[] = [`# ${owner} — memory`, '', `Exported ${stamp}. ${namespaces.reduce((n, x) => n + x.claims.length, 0)} claims in ${namespaces.length} namespace${namespaces.length === 1 ? '' : 's'}.`, '']
  for (const ns of namespaces) {
    md.push(`## ${ns.namespace}`, '', `v${ns.version}${ns.onChainVersion ? ` · on chain at v${ns.onChainVersion}` : ' · not on chain yet'}${ns.encrypted ? ' · private' : ' · public'}`, '')
    const bySubject = new Map<string, typeof ns.claims>()
    for (const k of ns.claims) {
      const s = k.subject ?? k.topic ?? 'Notes'
      bySubject.set(s, [...(bySubject.get(s) ?? []), k])
    }
    for (const [subject, claims] of bySubject) {
      md.push(`### ${subject}`, '')
      for (const k of claims) {
        const src = k.sources.map((s) => [s.name ?? s.type, s.id].filter(Boolean).join(' ')).join('; ') || 'no source'
        md.push(`- ${k.claim}  `, `  _${src} · ${Math.round(k.confidence * 100)}% · ${k.created_at.slice(0, 10)}_`)
      }
      md.push('')
    }
    md.push('<details><summary>History</summary>', '')
    for (const h of ns.history) md.push(`- v${h.version} · ${h.at.slice(0, 16).replace('T', ' ')} · ${h.message} (+${h.changes.added.length} ~${h.changes.updated.length} −${h.changes.removed.length})`)
    md.push('', '</details>', '')
  }
  return new Response(md.join('\n'), { headers: { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': `attachment; filename="${file}.md"`, 'cache-control': 'no-store' } })
}
