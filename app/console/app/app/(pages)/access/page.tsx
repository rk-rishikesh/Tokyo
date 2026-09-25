import Link from 'next/link'
import { accessOf, agentsOf, namespacesOf, pendingOf, readActivity, readOwnerKey } from '@k01/connect'
import { ownerOf, viewer } from '@/lib/session'
import { grantToAgent, revokeAgentEverywhere, revokeFromAgent } from '../../actions'
import { OwnerKeySetup } from '../OwnerKey'
import { Recover } from '../Recover'
import { Block, Lock, SignInFirst, Title, ago, short } from '../ui'
import { Arrow } from '@/components/Arrow'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Access' }

/**
 * Who can read your memory — including you, without this app.
 *
 * One page instead of three. Agents, Access and Portability each answered a
 * part of the same question and repeated the rest: the agents page listed
 * grants, the access page listed them again as a matrix, and portability
 * repeated the owner key and the publish panel. Here each thing appears once:
 *
 *   your key → the agents → who reads what → reading it without us
 *
 * Grants and revokes are staged; they reach the chain from Publish.
 */
export default async function Access() {
  const v = await viewer()
  const owner = ownerOf(v)
  if (!owner) return <SignInFirst />
  const userId = v.mode === 'hosted' ? v.user?.id : undefined

  const [rows, agents, pending] = await Promise.all([
    Promise.all(namespacesOf(owner).map((ns) => accessOf(ns))),
    agentsOf(owner),
    pendingOf(owner).catch(() => []),
  ])
  const hasKey = !!readOwnerKey(owner)
  const writes = readActivity(500, userId).filter((a) => a.outcome.status === 'committed').length
  const accessStaged = pending.filter((p) => p.accessChanged).map((p) => p.namespace)
  const published = rows.filter((r) => r.published).map((r) => r.namespace)

  return (
    <>
      <Title eyebrow="access" sub="Who may read each namespace — agents you allow, and you with your wallet alone. A grant seals the namespace's key to one agent; nothing else opens for it.">
        Who can read it.
      </Title>

      {accessStaged.length ? (
        <Link href="/app/publish" className="mb-2 flex flex-wrap items-center justify-between gap-3 rounded-[20px] bg-ink px-5 py-4 text-bg">
          <span className="text-[14px]">Access changed on {accessStaged.join(', ')} — not on chain until you publish. A revoked agent can still read the version on chain until then.</span>
          <span className="rounded-full bg-bg px-4 py-1.5 text-[14.5px] text-ink">Publish <Arrow /></span>
        </Link>
      ) : null}

      <Block
        title="Your key"
        note="A key only your wallet can re-create. Every namespace is sealed to it, so you can read your memory from anywhere."
      >
        <OwnerKeySetup owner={owner} has={hasKey} />
      </Block>

      <Block title="Agents" note="One writes. The others read what you seal to them — from the network, with their own key.">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-[22px] bg-ink p-5 text-bg">
            <p className="text-[15px]">Agent A — this app</p>
            <p className="mt-1 text-[14px] text-bg/60">writes, from the sources you connected</p>
            <p className="mt-5 font-display text-[40px] leading-none tracking-[-0.05em]">{writes}</p>
            <p className="mt-1 text-[13.5px] text-bg/60">claims written</p>
          </div>
          {agents.map((a) => (
            <div key={a.id} className="rounded-[22px] border border-line p-5">
              <p className="text-[15px]">{a.agent}</p>
              <p className="mt-1 truncate font-mono text-[12.5px] text-dim">{short(a.pubkey, 10)}</p>
              <ul className="mt-4 space-y-1.5 text-[14.5px]">
                {a.namespaces.map((n) => (
                  <li key={n.namespace} className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-ink" aria-hidden />
                    <span className="font-mono">{n.namespace}</span>
                    <span className="text-[13.5px] text-dim">{n.role} · {ago(n.grantedAt)}</span>
                  </li>
                ))}
              </ul>
              <form action={revokeAgentEverywhere.bind(null, a.id)} className="mt-4">
                <button className="rounded-full border border-line px-3.5 py-1.5 text-[14px]">Revoke everywhere</button>
              </form>
            </div>
          ))}
          {!agents.length ? (
            <div className="rounded-[22px] border border-dashed border-line p-5 text-[14.5px]">
              <p>No other agent yet</p>
              <p className="mt-1 text-dim">Agent B is a separate program with its own key. Start it and ask for access from its page:</p>
              <pre className="mt-3 rounded-2xl bg-raised px-4 py-3 font-mono text-[13.5px]">pnpm agent-b{'\n'}# open http://localhost:3002</pre>
            </div>
          ) : null}
        </div>
      </Block>

      <Block title="Who reads what" note="A tick is a sealed key. Revoking re-keys the namespace, so the old key opens nothing published after.">
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[14.5px]">
              <thead className="text-[13.5px] text-dim">
                <tr className="border-b border-line">
                  <th className="py-3 pr-4 font-normal">Namespace</th>
                  {agents.map((a) => <th key={a.id} className="px-4 py-3 font-normal">{a.agent}</th>)}
                  {!agents.length ? <th className="px-4 py-3 font-normal">Agents</th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.namespace} className="border-b border-line">
                    <td className="py-4 pr-4">
                      <p className="font-mono">{r.namespace}</p>
                      <div className="mt-1.5"><Lock encrypted={r.encrypted} agents={r.grants.filter((g) => !g.owner).length} /></div>
                    </td>
                    {agents.map((a) => {
                      const g = r.grants.find((x) => x.id === a.id)
                      return (
                        <td key={a.id} className="px-4 py-4">
                          {g ? (
                            <form action={revokeFromAgent.bind(null, r.namespace, a.id)} className="flex items-center gap-2">
                              <span>✓ {g.role}</span>
                              <button className="rounded-full border border-line px-2.5 py-0.5 text-[13px] text-dim hover:text-ink">revoke</button>
                            </form>
                          ) : (
                            <form action={grantToAgent.bind(null, r.namespace, a.agent, a.pubkey, 'read')} className="flex items-center gap-2">
                              <span className="text-dim">—</span>
                              <button className="rounded-full border border-line px-2.5 py-0.5 text-[13px] text-dim hover:text-ink">grant</button>
                            </form>
                          )}
                        </td>
                      )
                    })}
                    {!agents.length ? <td className="px-4 py-4 text-dim">none yet</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[14.5px] text-dim">No namespaces yet. Connect a source on the Agent tab and let it learn something.</p>
        )}
      </Block>

      <Block
        id="without-this-app"
        title="Without this app"
        note="The test the whole design answers to: delete this app and your memory is still readable."
      >
        <Recover owner={owner} namespaces={published} />
        <p className="mt-6 text-[14.5px] text-dim">Or have a different program read it after deleting everything this app keeps:</p>
        <pre className="mt-3 overflow-x-auto rounded-2xl bg-raised px-5 py-4 font-mono text-[14px] leading-relaxed">{`pnpm reset:local --apply   # delete this app's state
pnpm agent-b:read          # Agent B still reads what you granted`}</pre>
      </Block>
    </>
  )
}
