import Link from 'next/link'
import { Arrow } from '@/components/Arrow'
import { onchainRoles, policyMembers } from '@knowledge01/core'
import { ENS_DEPLOYMENT, ensExplorer, serverClient } from '@/lib/chain'
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
  // Who may publish, as ENS enforces it — not as the policy claims it.
  const chain = await onchainRoles(serverClient(), view.namespace, policyMembers(view.refs.policy)).catch(() => null)

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
          <p className="mt-1 text-[14px] text-dim">
            Registered on {ENS_DEPLOYMENT.label}, the deployment of {ENS_DEPLOYMENT.since} that ENS&apos;s own apps read.
            ENS resets Sepolia from time to time; when it does, names are registered again under the same name and their records copied across.
          </p>
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[14px]">
            <a href={ensExplorer(view.namespace)} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">Name on explorer.ens.dev ↗</a>
            <a href={ensExplorer(view.namespace, 'registry')} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">Registry and subnames ↗</a>
            <a href={ensExplorer(view.namespace, 'resolver')} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">Resolver ↗</a>
          </p>
        </Row>
        <Row label="Version pointer (contenthash)">
          {view.contenthash ? <p className="break-all font-mono text-[14px]">{view.contenthash}</p> : <p className="text-dim">Not published yet.</p>}
        </Row>
        <Row label="Stored on IPFS">
          {view.refsRef ? (
            refsUrl ? <a href={refsUrl} target="_blank" rel="noreferrer" className="break-all font-mono text-[14px] underline-offset-4 hover:underline">{view.refsRef}</a> : <p className="break-all font-mono text-[14px]">{view.refsRef}</p>
          ) : <p className="text-dim">Not published yet.</p>}
        </Row>
        <Row label="Who can write, on ENS">
          {!chain?.resolver ? <p className="text-dim">{chain ? 'Not registered on chain yet, so only the policy applies.' : 'Could not read ENS right now.'}</p> : (
            <>
              <ul className="space-y-2">
                {chain.roles.map((r) => (
                  <li key={r.name} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="w-20 text-[13px] capitalize text-dim">{r.role}</span>
                    <span className="font-mono text-[14px]">{r.name}</span>
                    {r.account ? <a href={`https://sepolia.etherscan.io/address/${r.account}`} target="_blank" rel="noreferrer" className="font-mono text-[12.5px] text-dim underline-offset-4 hover:underline">{r.account.slice(0, 6)}…{r.account.slice(-4)}</a> : <span className="text-[12.5px] text-dim">no owner on ENS</span>}
                    <span className={`rounded-full px-2 py-0.5 text-[12px] ${r.canPublish || r.canPropose ? 'bg-ink text-bg' : 'border border-line text-dim'}`}>{r.canGrant ? 'publishes · can grant' : r.canPublish ? 'publishes' : r.role === 'contributor' ? (r.canPropose ? 'can propose' : 'cannot propose') : 'cannot publish'}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[13px] leading-relaxed text-dim">
                Read live from the namespace&apos;s resolver <a href={`https://sepolia.etherscan.io/address/${chain.resolver}`} target="_blank" rel="noreferrer" className="font-mono underline-offset-4 hover:underline">{chain.resolver.slice(0, 6)}…{chain.resolver.slice(-4)}</a>. Publishing is <span className="font-mono">setContenthash</span>, which needs <span className="font-mono">ROLE_SET_CONTENTHASH</span>. Named contributors can instead write <span className="font-mono">ROLE_SET_DATA</span> on their own key, <span className="font-mono">knowledge.proposal.&lt;name&gt;</span>, to point the owner at a proposal. The owner grants both with <span className="font-mono">knowledge roles --sync</span>.{view.refs.policy.contributors === 'anyone' ? ' Anyone may contribute here, so proposals arrive as bundles rather than through ENS.' : ''}
              </p>
            </>
          )}
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
