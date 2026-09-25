import Link from 'next/link'
import { Badge, Card } from '@/components/ui'
import { loadRepo } from '@/lib/repoview'
import { STATUS_TONE } from '@/lib/status'
import { ownerOf, viewer } from '@/lib/session'
import { decisionsOf, namespacesOf, pendingOf, type Decision } from '@knowledge01/connect'
import { answerFinding, decideProposal } from '../../actions'
import { ChainPanel } from '../ChainPanel'
import { SignInFirst, Title, ago } from '../ui'
import { Arrow } from '@/components/Arrow'

export const dynamic = 'force-dynamic'

/**
 * Publish: what you are about to put on your name, and anything waiting on you.
 *
 * The one page with the Sign & publish button. It used to appear on Reviews,
 * Access and Portability; three copies of the same control made it unclear
 * which one to press and whether they did different things.
 *
 * This page used to list proposals across every namespace on the machine —
 * the explorer's view, which put other people's namespaces in your queue. It
 * is now yours only. The main list is the diff between your namespaces and
 * what your ENS name points at, read from the chain; underneath, proposals on
 * your own namespaces, if any agent has made one. Everyone else's proposals
 * are in the explorer, on the namespace they belong to.
 */
export const metadata = { title: 'Publish' }

export default async function Publish() {
  const owner = ownerOf(await viewer())
  if (!owner) return <SignInFirst />

  const mine = namespacesOf(owner)
  const [pending, views] = await Promise.all([
    pendingOf(owner),
    Promise.all(mine.map((n) => loadRepo(n).catch(() => null))),
  ])
  const decisions = decisionsOf(owner)
  const proposals = views.flatMap((view) => view
    ? Object.values(view.refs.proposals ?? {}).filter((p) => !['committed', 'rejected'].includes(p.status)).map((proposal) => ({ view, proposal }))
    : [])


  return (
    <div className="pb-10">
      <Title
        eyebrow="publish"
        sub="Everything below is in your namespaces on this machine and not yet on your ENS name. Look it over, then publish it in one signature. Nothing reaches the chain until you do."
      >
        What you&rsquo;re about to publish.
      </Title>

      {decisions.length ? (
        <section className="mb-12">
          <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="font-display text-[clamp(1.8rem,3vw,2.6rem)] font-normal leading-none tracking-[-0.045em]">Needs your decision.</h2>
            <p className="text-[14px] text-dim">{decisions.length} question{decisions.length === 1 ? '' : 's'} · answer each once</p>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            {decisions.map((d) => <DecisionCard key={`${d.commit}-${d.index}`} d={d} />)}
          </div>
        </section>
      ) : null}

      <ChainPanel owner={owner} />

      {pending.map((ns) => (
        <section key={ns.namespace} className="mt-16 border-t border-line pt-8">
          <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
            <div>
              <p className="font-mono text-[14px]">{ns.namespace}</p>
              <p className="mt-2 text-[14px] text-dim">
                {ns.onChain ? `Your name points at v${ns.onChain.version}.` : 'Never published — your name points at nothing yet.'}
                {ns.commits.length ? ` ${ns.commits.length} version${ns.commits.length === 1 ? '' : 's'} waiting.` : ' Up to date.'}
              </p>
              {ns.accessChanged ? <p className="mt-2 inline-block rounded-full bg-ink px-2.5 py-1 text-[12.5px] text-bg">who may read it has changed</p> : null}
              <Link href={`/k/${encodeURIComponent(ns.namespace)}/history`} className="mt-4 block text-[14px] text-ink/60 underline-offset-4 hover:text-ink hover:underline">Full history <Arrow /></Link>
            </div>

            {ns.commits.length ? (
              <ol className="border-t border-line">
                {ns.commits.map((c) => (
                  <li key={c.id} className="grid gap-3 border-b border-line py-5 sm:grid-cols-[4.5rem_1fr]">
                    <div>
                      <span className="rounded-full bg-raised px-2.5 py-1 text-[12.5px]">v{c.version}</span>
                      <p className="mt-2 text-[12.5px] text-dim">{ago(c.at)}</p>
                    </div>
                    <div>
                      <p className="text-[15px] tracking-[-0.015em]">{c.message}</p>
                      {c.added.length ? (
                        <ul className="mt-3 space-y-2">
                          {c.added.map((k) => (
                            <li key={k.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                              <span className="text-[13.5px] text-ink/85">+ {k.claim}</span>
                              <span className="font-mono text-[12.5px] text-dim">{k.sources.join(', ') || 'no source'} · {Math.round(k.confidence * 100)}%</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {c.updated || c.removed ? (
                        <p className="mt-2 text-[13.5px] text-dim">{c.updated ? `${c.updated} updated` : ''}{c.updated && c.removed ? ' · ' : ''}{c.removed ? `${c.removed} removed` : ''}</p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="self-center text-[14.5px] text-dim">Nothing waiting. The chain says exactly what this namespace says.</p>
            )}
          </div>
        </section>
      ))}

      {proposals.length ? (
        <section className="mt-20 border-t border-line pt-8">
          <div className="mb-8 grid gap-6 lg:grid-cols-2">
            <h2 className="font-display text-[clamp(1.8rem,3.2vw,2.9rem)] font-normal leading-[0.98] tracking-[-0.045em]">Waiting on you.</h2>
            <p className="max-w-xl text-[15px] leading-relaxed text-dim">Proposals an agent or contributor made to your namespaces. Approve to land them — they then wait above like any other change.</p>
          </div>
          <div className="space-y-3">
          {proposals.map(({ view, proposal: p }) => {
            const base = `/k/${encodeURIComponent(view.namespace)}/reviews/${p.number}`
            const src = [...new Set(view.commits[view.refs.branches[p.branch] ?? '']?.changes.added.flatMap((id) => view.commits[view.refs.branches[p.branch] ?? '']?.snapshot[id]?.sources.map((s) => s.name ?? s.type) ?? []) ?? [])]
            return (
              <Card key={`${view.namespace}${p.id}`} className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[13.5px] text-muted-foreground">{view.namespace}</span>
                  <h2 className="text-base font-semibold">{p.title}</h2>
                  <Badge tone={STATUS_TONE[p.status]}>{p.status.replace('-', ' ')}</Badge>
                  {p.findings.length ? <Badge tone="warn">{p.findings.length} finding{p.findings.length === 1 ? '' : 's'}</Badge> : <Badge tone="added">no findings</Badge>}
                </div>
                <p className="mt-1 text-[13.5px] text-muted-foreground">Proposed by {p.author} · {src.length ? `Source: ${src.join(', ')}` : 'no sources attached'} · {new Set(p.reviews.filter((r) => r.verdict === 'approve').map((r) => r.reviewer)).size}/{view.refs.policy.approvals} approvals · reviewers: {view.refs.policy.reviewers.join(', ') || view.refs.policy.owner}</p>
                {(() => {
                  // The evidence: each claim the proposal would add, with the sources it cites.
                  const tip = view.commits[view.refs.branches[p.branch] ?? '']
                  const base = view.commits[view.refs.branches[p.base] ?? '']?.snapshot ?? {}
                  const added = Object.values(tip?.snapshot ?? {}).filter((k) => !base[k.id])
                  return added.length ? (
                    <ul className="mt-3 space-y-1.5 rounded-xl border border-border bg-muted/40 px-3 py-2.5">
                      {added.slice(0, 8).map((k) => (
                        <li key={k.id} className="text-[15px]">
                          {k.claim}
                          <span className="ml-2 font-mono text-[12.5px] text-muted-foreground">evidence: {k.sources.map((s) => [s.name ?? s.type, s.id].filter(Boolean).join(' ')).join(' · ') || 'none'} · {Math.round(k.confidence * 100)}%</span>
                        </li>
                      ))}
                    </ul>
                  ) : null
                })()}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {mine.includes(view.namespace) ? (
                    <>
                      <form action={decideProposal.bind(null, view.namespace, p.number, 'approve')}><button className="rounded-md bg-ink px-3 py-1.5 text-[15px] text-bg">Approve</button></form>
                      <form action={decideProposal.bind(null, view.namespace, p.number, 'reject')}><button className="rounded-md border border-border px-3 py-1.5 text-[15px]">Reject</button></form>
                      <Link href={base} className="rounded-md border border-border px-3 py-1.5 text-[15px]">Compare</Link>
                    </>
                  ) : (
                    <>
                      <Link href={base} className="rounded-md bg-ink px-3 py-1.5 text-[15px] text-bg">Compare</Link>
                      <code className="rounded-md border border-border bg-muted px-2 py-1 font-mono text-[12.5px]">knowledge review {p.number} --approve --as {view.refs.policy.reviewers[0] ?? view.refs.policy.owner} -n {view.namespace}</code>
                      <code className="rounded-md border border-border bg-muted px-2 py-1 font-mono text-[12.5px]">knowledge review {p.number} --reject -m "…" --as {view.refs.policy.reviewers[0] ?? view.refs.policy.owner} -n {view.namespace}</code>
                    </>
                  )}
                </div>
              </Card>
            )
          })}
          </div>
        </section>
      ) : null}

      <p className="mt-16 max-w-2xl text-[14px] leading-relaxed text-dim">
        Proposals on namespaces you do not own are reviewed by their own reviewers, on the namespace itself — see them in the <Link href="/namespaces" className="text-ink underline-offset-4 hover:underline">explorer</Link>.
      </p>
    </div>
  )
}

function ClaimBox({ label, k }: { label: string; k: NonNullable<Decision['other']> }) {
  return (
    <div className="flex-1 rounded-[18px] border border-line bg-bg p-4">
      <p className="text-[12.5px] text-dim">{label}</p>
      <p className="mt-1.5 text-[16px] leading-snug tracking-[-0.015em]">{k.claim}</p>
      <p className="mt-2 text-[13px] text-dim">
        {k.sources.map((s) => s.name ?? s.type).join(', ') || 'no source'} · {Math.round(k.confidence * 100)}% · {k.created_at.slice(0, 10)}
      </p>
    </div>
  )
}

/** One question, both claims, and the answers as buttons. */
function DecisionCard({ d }: { d: Decision }) {
  return (
    <div className="rounded-[24px] border border-line bg-surface p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[20px] tracking-[-0.02em]">{d.question}</h3>
        <span className="font-mono text-[12.5px] text-dim">{d.namespace}</span>
      </div>
      <p className="mt-1 text-[14px] text-dim">{d.why}</p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <ClaimBox label={d.other ? 'New' : 'Claim'} k={d.claim} />
        {d.other ? <ClaimBox label="Already in your memory" k={d.other} /> : null}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {d.answers.map((a, i) => (
          <form key={a.id} action={answerFinding.bind(null, d.namespace, d.commit, d.index, a.id)}>
            <button className={`rounded-full px-4 py-2 text-[14px] transition ${i === 0 ? 'bg-ink text-bg hover:opacity-85' : 'border border-line hover:bg-raised'}`}>{a.label}</button>
          </form>
        ))}
      </div>
    </div>
  )
}
