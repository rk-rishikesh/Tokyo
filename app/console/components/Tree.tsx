'use client'

/**
 * The namespace tree: identity → namespace → branches.
 *
 * Laid out once; only the words swap with the vocabulary. The shape *is* the
 * claim — the technical story and the plain one are the same story.
 *
 * Drawn as layers rather than boxes on a line: a rail on the left says where
 * each tier physically lives (the chain, IPFS, the branches inside it), the
 * name sits in ink because it is the one thing someone owns, the pointer forks
 * into both branches, and the proposal's route back into main is drawn as the
 * dashed arrow it is — nothing reaches main except through review.
 */
import { CHILDREN, MEMORY, ROOT, type GraphNode, type Mode } from '@/content/copy'

const TIERS: { id: string; ens: [string, string]; plain: [string, string] }[] = [
  { id: 'chain', ens: ['On chain', 'ENSv2 registry + resolver'], plain: ['Owned', 'a name someone holds'] },
  { id: 'ipfs', ens: ['On IPFS', 'one pointer, moved per push'], plain: ['Published', 'the address of the newest edition'] },
  { id: 'branches', ens: ['Inside the refs', 'branches → commits → CIDs'], plain: ['Inside it', 'what is checked, and what is proposed'] },
]

function Card({ node, mode, tone }: { node: GraphNode; mode: Mode; tone: 'ink' | 'line' | 'dashed' }) {
  const r = node[mode]
  const ink = tone === 'ink'
  return (
    <div
      className={`relative w-full rounded-[22px] p-5 sm:p-6 ${
        ink ? 'bg-ink text-bg shadow-[0_24px_50px_-28px_rgba(0,0,0,0.55)]'
          : tone === 'dashed' ? 'border border-dashed border-ink/30 bg-bg'
            : 'border border-line bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.03),0_16px_36px_-26px_rgba(0,0,0,0.35)]'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className={`text-[12.5px] tracking-[-0.005em] ${ink ? 'text-bg/55' : 'text-dim'}`}>{node.heldBy[mode]}</span>
        <span className={`h-1.5 w-1.5 rounded-full ${ink ? 'bg-bg' : tone === 'dashed' ? 'border border-ink/50' : 'bg-ink'}`} aria-hidden />
      </div>
      <p
        key={`${node.id}-${mode}-l`}
        className={`relabel mt-3 break-words leading-tight tracking-[-0.03em] ${mode === 'ens' ? 'font-mono text-[15px] sm:text-[16px]' : 'text-[clamp(1.2rem,1.7vw,1.5rem)]'}`}
      >
        {r.label}
      </p>
      <p key={`${node.id}-${mode}-d`} className={`relabel mt-2.5 text-[14.5px] leading-relaxed ${ink ? 'text-bg/65' : 'text-dim'}`}>{r.detail}</p>
    </div>
  )
}

/** A short vertical wire with an arrowhead, between two tiers. */
function Down() {
  return (
    <svg className="mx-auto block h-12 w-4 overflow-visible" viewBox="0 0 16 48" aria-hidden>
      <path d="M 8 0 L 8 42" className="stroke-[hsl(var(--ink)/0.35)]" strokeWidth={1.4} fill="none" />
      <path d="M 4 38 L 8 44 L 12 38" className="stroke-[hsl(var(--ink)/0.5)]" strokeWidth={1.4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle r={2.6} className="kn-tree-dot fill-[hsl(var(--ink))]" cx={8} cy={0} />
    </svg>
  )
}

/** The fork from the pointer into both branches, drawn to the centres of a two-column grid. */
function Fork() {
  return (
    <svg className="block h-16 w-full overflow-visible" viewBox="0 0 100 64" preserveAspectRatio="none" aria-hidden>
      {/* Column centres of a two-column grid with a 4rem gap, as a share of its width. */}
      {[23.4, 76.6].map((x) => (
        <path
          key={x}
          d={`M 50 0 L 50 16 C 50 32, ${x} 24, ${x} 42 L ${x} 64`}
          className="stroke-[hsl(var(--ink)/0.35)]"
          strokeWidth={1.4}
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  )
}

function Tier({ tier, mode, children }: { tier: (typeof TIERS)[number]; mode: Mode; children: React.ReactNode }) {
  const [name, sub] = tier[mode]
  return (
    <div className="grid gap-4 lg:grid-cols-[14rem_1fr] lg:gap-10">
      <div className="border-t border-line pt-3 lg:pt-5">
        <p key={`${tier.id}-${mode}-n`} className="relabel text-[14.5px] tracking-[-0.01em]">{name}.</p>
        <p key={`${tier.id}-${mode}-s`} className="relabel mt-0.5 text-[13.5px] text-dim">{sub}</p>
      </div>
      <div>{children}</div>
    </div>
  )
}

export function Tree({ mode }: { mode: Mode }) {
  const [main, proposal] = CHILDREN
  return (
    <div className="w-full rounded-[28px] bg-canvas p-6 sm:p-10 [background-image:radial-gradient(hsl(var(--ink)/0.09)_1px,transparent_1px)] [background-size:22px_22px]">
      <Tier tier={TIERS[0]!} mode={mode}>
        <div className="mx-auto max-w-xl"><Card node={ROOT} mode={mode} tone="ink" /></div>
      </Tier>
      <div className="lg:ml-[16.5rem]"><Down /></div>

      <Tier tier={TIERS[1]!} mode={mode}>
        <div className="mx-auto max-w-2xl"><Card node={MEMORY} mode={mode} tone="line" /></div>
      </Tier>
      <div className="hidden lg:ml-[16.5rem] lg:block"><Fork /></div>
      <div className="lg:hidden"><Down /></div>

      <Tier tier={TIERS[2]!} mode={mode}>
        <div className="relative grid gap-4 sm:grid-cols-2 sm:gap-16">
          <Card node={main!} mode={mode} tone="line" />
          <Card node={proposal!} mode={mode} tone="dashed" />

          {/* The only route into main: back from the proposal, through review. */}
          <div className="pointer-events-none absolute inset-y-0 left-1/2 hidden w-16 -translate-x-1/2 items-center sm:flex" aria-hidden>
            <svg className="h-10 w-16 overflow-visible" viewBox="0 0 64 40">
              <path d="M 60 20 L 6 20" className="kn-tree-merge stroke-[hsl(var(--ink)/0.55)]" strokeWidth={1.4} strokeDasharray="4 5" fill="none" />
              <path d="M 11 15 L 4 20 L 11 25" className="stroke-[hsl(var(--ink)/0.7)]" strokeWidth={1.4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
        <p key={`merge-${mode}`} className="relabel mt-4 text-center text-[13.5px] text-dim sm:pl-[calc(50%+2rem)] sm:text-left">
          {mode === 'ens' ? '← lands on main through review, merged three-way by claim id' : '← becomes the next edition only once a reviewer approves'}
        </p>
      </Tier>
    </div>
  )
}
