import Link from 'next/link'
import { Arrow } from '@/components/Arrow'
import { defaultBranch, logOf, openProposals, versionOf } from '@/lib/repoview'
import { NamespaceHeader, load, type Params } from '../_shared'

export const dynamic = 'force-dynamic'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 border-b border-line py-5 sm:grid-cols-[14rem_1fr]">
      <p className="text-[14px] text-dim">{label}</p>
      <div className="min-w-0 text-[15px]">{children}</div>
    </div>
  )
}

/**
 * Info: the version, where the namespace lives, and how to use it.
 *
 * These sat in a narrow sidebar beside the claims, truncating hashes and code
 * mid-word. Here they have the width to be read — and copied — whole.
 */
export default async function Info({ params }: { params: Params }) {
  const { view, branch } = await load(params)
  const base = `/k/${encodeURIComponent(view.namespace)}`
  const main = defaultBranch(view)
  const latest = logOf(view, main, 1)[0]
  const open = openProposals(view)
  const refsUrl = view.refsRef ? view.gatewayUrl(view.refsRef) : null
  const isPublic = view.refs.policy.readers === 'public'

  return (
    <>
      <NamespaceHeader view={view} branch={branch} active="info" />
      <div className="border-t border-line">
        <Row label="Current version">
          {latest ? (
            <>
              <p><span className="font-mono font-semibold">v{versionOf(view, main)}</span> <span className="font-mono text-dim">{latest.id.slice(0, 10)}</span></p>
              <p className="mt-1 text-dim">{latest.message} · {latest.author} · {latest.timestamp.slice(0, 10)}</p>
              {open.length ? <Link href={`${base}/reviews`} className="group mt-2 inline-flex items-center gap-1.5 underline-offset-4 hover:underline">{open.length} proposal{open.length === 1 ? '' : 's'} awaiting review <Arrow /></Link> : null}
            </>
          ) : <p className="text-dim">No versions yet.</p>}
        </Row>
        <Row label="ENS name">
          <p className="font-mono">{view.namespace}</p>
        </Row>
        <Row label="Version pointer (contenthash)">
          {view.contenthash ? <p className="break-all font-mono text-[14px]">{view.contenthash}</p> : <p className="text-dim">Not published yet.</p>}
        </Row>
        <Row label="Stored on IPFS">
          {view.refsRef ? (
            refsUrl ? <a href={refsUrl} target="_blank" rel="noreferrer" className="break-all font-mono text-[14px] underline-offset-4 hover:underline">{view.refsRef}</a> : <p className="break-all font-mono text-[14px]">{view.refsRef}</p>
          ) : <p className="text-dim">Not published yet.</p>}
        </Row>
        <Row label="Who can read it">
          <p>{isPublic ? 'Anyone. It is stored as plain text, so any agent can read it.' : 'Only people and agents holding its key. Everything is stored encrypted.'}</p>
        </Row>
        <Row label="Use it">
          <pre className="overflow-x-auto rounded-2xl bg-raised p-4 font-mono text-[13.5px] leading-relaxed"><code>{`# command line
knowledge init ${view.namespace}
knowledge pull
knowledge search "…"

# agents (MCP)
knowledge_search({ namespace: "${view.namespace}", query })`}</code></pre>
        </Row>
      </div>
    </>
  )
}
