/**
 * The loop, as a living network rather than an architecture diagram.
 *
 * Packets travel the spine continuously so the eye reads flow rather than
 * boxes. Pure SVG with `animateMotion` — no animation library, no video, and no
 * JavaScript, so it runs before hydration and costs nothing on a phone.
 *
 * Every source named here is one this product can actually read. An earlier
 * version labelled them Food, Shopping and Travel, which described a wish
 * rather than a product — DoorDash, Amazon and Airbnb publish nothing a person
 * can use to read their own history, so a diagram promising those arrows would
 * be drawing an integration that cannot exist.
 *
 * Google Takeout is how orders arrive, which is the honest version of the same
 * claim: not a food app, but the one door that food orders come through.
 */

const SOURCES = [
  { label: 'GitHub', glyph: '🐙', claim: 'Writes TypeScript' },
  { label: 'Granola', glyph: '🌀', claim: 'Meets Sarah weekly' },
  { label: 'Takeout', glyph: '📦', claim: 'Orders from Dishoom' },
  { label: 'Linear', glyph: '📐', claim: 'Works on Platform' },
  { label: 'Your editor', glyph: '⌨️', claim: 'pnpm, never npm' },
]

const CONSUMERS = [
  { label: 'Your agent', glyph: '🤖' },
  { label: 'A new app', glyph: '🧩' },
  { label: 'You', glyph: '👤' },
]

/** y-coordinates on the 760-tall canvas. */
const Y = {
  sources: 84,
  propose: 214,
  review: 278,
  commit: 342,
  ens: 440,
  ipfs: 524,
  network: 592,
  consumers: 686,
}

const CX = 420

function Stage({ y, label, sub, delay }: { y: number; label: string; sub?: string; delay: number }) {
  return (
    <g className="kn-fade" style={{ animationDelay: `${delay}s` }}>
      <rect x={CX - 96} y={y - 18} width={192} height={36} rx={18} className="fill-[hsl(var(--surface))] stroke-[hsl(var(--line))]" strokeWidth={1} />
      <text x={CX} y={y + 4} textAnchor="middle" className="fill-[hsl(var(--ink))] font-mono text-[11px] tracking-[0.16em]">
        {label}
      </text>
      {sub ? (
        <text x={CX + 112} y={y + 4} className="fill-[hsl(var(--dim))] text-[11px]">{sub}</text>
      ) : null}
    </g>
  )
}

export function KnowledgeFlow() {
  return (
    <div className="relative -mx-6 w-[calc(100%+3rem)] overflow-x-auto px-6 sm:mx-0 sm:w-full sm:overflow-visible sm:px-0">
      <svg
        viewBox="0 0 840 760"
        className="h-auto w-full min-w-[580px]"
        role="img"
        aria-label="Apps observe what you do; each observation is proposed, reviewed and committed as a claim; the namespace is an ENS name you own and the versions live on IPFS; your agent, a new app, and you read the same claims and contribute back."
      >
        {/* ---- the apps that observe -------------------------------------- */}
        {SOURCES.map((s, i) => {
          const x = 84 + i * 168
          const path = `M ${x} ${Y.sources + 30} C ${x} ${Y.sources + 80}, ${CX} ${Y.propose - 74}, ${CX} ${Y.propose - 20}`
          return (
            <g key={s.label}>
              <g className="kn-fade" style={{ animationDelay: `${i * 0.08}s` }}>
                <circle cx={x} cy={Y.sources} r={22} className="fill-[hsl(var(--surface))] stroke-[hsl(var(--line))]" strokeWidth={1} />
                <text x={x} y={Y.sources + 7} textAnchor="middle" className="text-[18px]">{s.glyph}</text>
                <text x={x} y={Y.sources - 32} textAnchor="middle" className="fill-[hsl(var(--dim))] text-[11px]">{s.label}</text>
              </g>
              <path d={path} className="stroke-[hsl(var(--line))]" strokeWidth={1} fill="none" />
              <circle r={3} className="fill-[hsl(var(--accent))]">
                <animateMotion dur={`${3.6 + i * 0.45}s`} repeatCount="indefinite" begin={`${i * 0.5}s`} path={path} />
              </circle>
            </g>
          )
        })}

        <text x={CX} y={Y.sources + 76} textAnchor="middle" className="fill-[hsl(var(--dim))] text-[11px]">
          apps you already use, observing — never reading your messages
        </text>

        {/* ---- propose → review → commit ---------------------------------- */}
        <Stage y={Y.propose} label="PROPOSE" sub="a claim, with its source" delay={0.1} />
        <Stage y={Y.review} label="REVIEW" sub="duplicates, contradictions" delay={0.18} />
        <Stage y={Y.commit} label="COMMIT" sub="a version, not an overwrite" delay={0.26} />

        {[
          [Y.propose + 18, Y.review - 18],
          [Y.review + 18, Y.commit - 18],
          [Y.commit + 18, Y.ens - 20],
        ].map(([from, to], i) => (
          <g key={i}>
            <line x1={CX} y1={from} x2={CX} y2={to} className="stroke-[hsl(var(--line))]" strokeWidth={1} />
            <circle r={3} className="fill-[hsl(var(--accent))]">
              <animateMotion dur="2.4s" repeatCount="indefinite" begin={`${0.4 + i * 0.3}s`} path={`M ${CX} ${from} L ${CX} ${to}`} />
            </circle>
          </g>
        ))}

        {/* ---- the name you own, and where the versions live -------------- */}
        <g className="kn-fade" style={{ animationDelay: '0.34s' }}>
          <rect x={CX - 132} y={Y.ens - 22} width={264} height={44} rx={12} className="fill-[hsl(var(--accent-soft))] stroke-[hsl(var(--accent)/0.4)]" strokeWidth={1} />
          <text x={CX} y={Y.ens + 5} textAnchor="middle" className="fill-[hsl(var(--ink))] font-mono text-[13px]">
            food.yours.eth
          </text>
          <text x={CX} y={Y.ens - 34} textAnchor="middle" className="fill-[hsl(var(--dim))] text-[11px]">
            an ENS name you own — not an account we lend you
          </text>
        </g>

        <line x1={CX} y1={Y.ens + 22} x2={CX} y2={Y.ipfs - 18} className="stroke-[hsl(var(--line))]" strokeWidth={1} />
        <circle r={3} className="fill-[hsl(var(--accent))]">
          <animateMotion dur="2.6s" repeatCount="indefinite" begin="1.1s" path={`M ${CX} ${Y.ens + 22} L ${CX} ${Y.ipfs - 18}`} />
        </circle>

        <Stage y={Y.ipfs} label="IPFS" sub="every version, addressable" delay={0.42} />

        <line x1={CX} y1={Y.ipfs + 18} x2={CX} y2={Y.network - 18} className="stroke-[hsl(var(--line))]" strokeWidth={1} />
        <Stage y={Y.network} label="THE NETWORK" sub="anyone can resolve it" delay={0.5} />

        {/* ---- who reads it, and contributes back ------------------------- */}
        {CONSUMERS.map((c, i) => {
          const x = 168 + i * 252
          const down = `M ${CX} ${Y.network + 18} C ${CX} ${Y.network + 56}, ${x} ${Y.consumers - 60}, ${x} ${Y.consumers - 26}`
          return (
            <g key={c.label}>
              <path d={down} className="stroke-[hsl(var(--line))]" strokeWidth={1} fill="none" />
              <circle r={3} className="fill-[hsl(var(--accent))]">
                <animateMotion dur={`${3 + i * 0.4}s`} repeatCount="indefinite" begin={`${1.6 + i * 0.35}s`} path={down} />
              </circle>
              <g className="kn-fade" style={{ animationDelay: `${0.6 + i * 0.08}s` }}>
                <circle cx={x} cy={Y.consumers} r={22} className="fill-[hsl(var(--surface))] stroke-[hsl(var(--line))]" strokeWidth={1} />
                <text x={x} y={Y.consumers + 7} textAnchor="middle" className="text-[18px]">{c.glyph}</text>
                <text x={x} y={Y.consumers + 44} textAnchor="middle" className="fill-[hsl(var(--dim))] text-[11px]">{c.label}</text>
              </g>
            </g>
          )
        })}

        {/* The return path: what is read becomes what is contributed. */}
        <path
          d={`M 168 ${Y.consumers + 26} C 40 ${Y.consumers + 60}, 24 ${Y.sources - 40}, 84 ${Y.sources - 34}`}
          className="stroke-[hsl(var(--accent)/0.35)]"
          strokeWidth={1}
          strokeDasharray="4 5"
          fill="none"
        />
        <text x={38} y={Y.network} className="fill-[hsl(var(--dim))] text-[10.5px]" transform={`rotate(-90 38 ${Y.network})`}>
          and contribute back
        </text>
      </svg>
    </div>
  )
}

/** The same loop as one line, for places that need the claim not the picture. */
export function FlowClaim() {
  return (
    <p className="text-center font-mono text-[11.5px] tracking-wide text-dim">
      observe → propose → review → commit → your name → IPFS → anyone ↺
    </p>
  )
}
