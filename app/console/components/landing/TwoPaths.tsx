/**
 * The two ways a claim gets in.
 *
 * This was the idea from the start and the landing page had stopped saying it.
 * Memory arrives either because *you* connected something, or because an agent
 * you already use proposed it — and both end in the same place: a proposal in a
 * namespace you own, which you review.
 *
 * The distinction matters because it is what makes this a network rather than
 * another connector product. The second path means an application never has to
 * integrate with us at all: it speaks MCP to a namespace, and the person in the
 * middle decides what lands.
 */

type Path = {
  n: string
  title: string
  body: string
  steps: string[]
  live: string
}

const PATHS: Path[] = [
  {
    n: '01',
    title: 'You connect an app',
    body:
      'Grant read access to something you already use. It observes patterns — never messages, never contents — and proposes what it learns. The consent screen is generated from the thresholds the reader actually uses, so it cannot promise one thing and do another.',
    steps: [
      'Connect a source',
      'It observes a pattern, not an event',
      'A claim is proposed, citing what it saw',
      'You review, then it lands',
    ],
    live: 'GitHub, Granola, Google Workspace and Linear today',
  },
  {
    n: '02',
    title: 'An agent writes to you',
    body:
      'Any assistant that speaks MCP can propose to a namespace you own. It does not integrate with us and we never see its data — it resolves your name, proposes a claim, and the policy on that namespace decides what happens next.',
    steps: [
      'Point an agent at your namespace over MCP',
      'It proposes what it learned while working',
      'Findings run: duplicates, contradictions, missing sources',
      'You approve or reject, in Reviews',
    ],
    live: 'Any MCP client — Claude, Cursor, or your own',
  },
]

export function TwoPaths() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {PATHS.map((p, i) => (
        <div key={p.n} className="kn-rise rounded-3xl border border-line bg-surface p-6" style={{ animationDelay: `${i * 0.08}s` }}>
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-[12.5px] text-dim">{p.n}</span>
            <h3 className="font-display text-[clamp(1.4rem,2.4vw,1.85rem)] leading-[1.02] tracking-[-0.025em]">{p.title}</h3>
          </div>
          <p className="mt-3 text-[13.5px] leading-relaxed text-dim">{p.body}</p>

          <ol className="mt-5 space-y-2">
            {p.steps.map((s, j) => (
              <li key={s} className="flex items-start gap-3 text-[14.5px]">
                <span className="mt-[3px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-line text-[12px] text-dim">
                  {j + 1}
                </span>
                {s}
              </li>
            ))}
          </ol>

          <p className="mt-5 border-t border-line pt-3 text-[13px] text-dim">
            <span className="text-accent">Live:</span> {p.live}
          </p>
        </div>
      ))}
    </div>
  )
}

/**
 * Where both paths meet.
 *
 * Both end in review, which is the part people do not expect: an agent can
 * propose anything, and nothing lands without clearing the namespace's policy.
 */
export function BothPathsMeet() {
  return (
    <div className="mx-auto mt-4 max-w-2xl rounded-3xl border border-accent/35 bg-accent-soft p-6 text-center">
      <p className="font-display text-[clamp(1.25rem,2vw,1.55rem)] leading-[1.05] tracking-[-0.02em]">Both end in the same place</p>
      <p className="mx-auto mt-2 max-w-lg text-[13.5px] leading-relaxed text-dim">
        A proposal in a namespace you own. Automated findings run first — duplicates, contradictions, claims with no
        source — and then a person decides. Contributing and committing are deliberately different things.
      </p>
    </div>
  )
}
