import { accessOf, namespacesOf } from '@k01/connect'
import { ownerOf, viewer } from '@/lib/session'
import { answerAccessRequest } from '../../actions'
import { Lock, SignInFirst, Title, short } from '../ui'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'An agent is asking to read your memory' }

type Q = { agent?: string; pubkey?: string; name?: string; role?: string; redirect_uri?: string; state?: string }

/**
 * An agent asking for access, the way an OAuth client asks for scopes.
 *
 * The difference is what "allow" does. OAuth gives the client a token our
 * server will honour; this seals each ticked namespace's key to the agent's
 * public key and publishes it. After that the agent never talks to us — it
 * reads the network — and nothing it was not given can be opened with its key.
 */
export default async function Authorize({ searchParams }: { searchParams: Promise<Q> }) {
  const q = await searchParams
  const owner = ownerOf(await viewer())
  if (!owner) return <SignInFirst />

  const pubkey = q.pubkey ?? ''
  const valid = /^0x(04[0-9a-fA-F]{128}|0[23][0-9a-fA-F]{64})$/.test(pubkey)
  const agent = (q.agent ?? 'An unnamed agent').slice(0, 60)
  const role = q.role === 'propose' ? 'propose' : 'read'
  let back: URL | null = null
  try { back = q.redirect_uri ? new URL(q.redirect_uri) : null } catch { back = null }

  if (!valid || !back || !/^https?:$/.test(back.protocol)) {
    return (
      <>
        <Title eyebrow="access request">This request is malformed.</Title>
        <p className="text-dim">An agent asking for access has to send a public key and somewhere to return to. This one did not, so there is nothing to grant.</p>
      </>
    )
  }

  const mine = namespacesOf(owner)
  const rows = await Promise.all(mine.map((ns) => accessOf(ns)))
  const wrongName = q.name && q.name !== owner

  return (
    <>
      <Title eyebrow="access request" sub={<>It will read from the network with its own key. It will not get your OAuth tokens, your sources, or anything you leave unticked — the bytes for those stay ciphertext to it.</>}>
        {agent} wants to {role === 'read' ? 'read' : 'propose to'} your memory.
      </Title>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <form action={answerAccessRequest} className="rounded-3xl border border-line bg-surface p-6">
          <input type="hidden" name="agent" value={agent} />
          <input type="hidden" name="pubkey" value={pubkey} />
          <input type="hidden" name="role" value={role} />
          <input type="hidden" name="redirect_uri" value={back.toString()} />
          <input type="hidden" name="state" value={q.state ?? ''} />

          {wrongName ? (
            <p className="mb-4 rounded-2xl bg-warn-bg px-4 py-3 text-[14.5px] text-warn">It asked about <b>{q.name}</b>, but you are signed in as <b>{owner}</b>. You can only grant what you own.</p>
          ) : null}

          <p className="text-[14.5px] font-medium">Choose what it may read</p>
          {rows.length ? (
            <ul className="mt-3 divide-y divide-line rounded-2xl border border-line">
              {rows.map((r) => {
                const agents = r.grants.filter((g) => !g.owner).length
                return (
                  <li key={r.namespace} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <input type="hidden" name="offered" value={r.namespace} />
                    <input id={`ns-${r.namespace}`} type="checkbox" name="ns" value={r.namespace} className="h-4 w-4" />
                    <label htmlFor={`ns-${r.namespace}`} className="font-mono text-[14.5px]">{r.namespace}</label>
                    <span className="text-[13.5px] text-dim">{r.claims} claim{r.claims === 1 ? '' : 's'} · v{r.version}</span>
                    <span className="ml-auto"><Lock encrypted={r.encrypted} agents={agents} /></span>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="mt-3 text-[14.5px] text-dim">You have no namespaces yet. Connect a source in the app and let it learn something first.</p>
          )}

          <div className="mt-6 flex flex-wrap gap-2">
            <button name="decision" value="allow" className="rounded-full bg-ink px-5 py-2.5 text-[15px] text-bg">Allow the ticked namespaces</button>
            <button name="decision" value="deny" className="rounded-full border border-line px-5 py-2.5 text-[15px]">Deny</button>
          </div>
          <p className="mt-3 text-[13.5px] text-dim">You can revoke any of this later. Revoking re-keys the namespace, so the agent cannot open anything published after — though it may have kept what it already read.</p>
        </form>

        <aside className="space-y-3 text-[14.5px]">
          <div className="rounded-3xl border border-line p-5">
            <p className="text-dim">Agent</p>
            <p className="mt-0.5 font-medium">{agent}</p>
            <p className="mt-3 text-dim">Its public key</p>
            <p className="mt-0.5 break-all font-mono text-[13px]">{short(pubkey, 12)}</p>
            <p className="mt-3 text-dim">Returns to</p>
            <p className="mt-0.5 break-all font-mono text-[13px]">{back.origin}</p>
            <p className="mt-3 text-dim">Asking to</p>
            <p className="mt-0.5">{role === 'read' ? 'read claims' : 'read and propose claims for your review'}</p>
          </div>
          <p className="px-1 text-[13.5px] leading-relaxed text-dim">The name it uses is its own label. What identifies it is the key — the one each namespace&apos;s content key will be sealed to.</p>
        </aside>
      </div>
    </>
  )
}
