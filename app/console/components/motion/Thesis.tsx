'use client'

/**
 * The thesis in eight scenes: one agent learns, a different one reads, the
 * first one is deleted, and nothing is lost.
 *
 * A Remotion composition played in the page. Each scene holds for three
 * seconds; the diagram on the right carries state from one scene to the next
 * rather than cutting, so the eye follows the memory, not the slides.
 *
 * Every claim shown is one this product's readers actually produce.
 */
import { Player } from '@remotion/player'
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'

const W = 1760
const H = 720
const SCENE = 96
const SCENES = 8

const ink = (a = 1) => `hsl(var(--ink) / ${a})`
const bg = (a = 1) => `hsl(var(--bg) / ${a})`
const FONT = 'var(--font-grotesk), var(--font-sans), sans-serif'

const COPY: { title: string; body: string }[] = [
  { title: 'Agent A learns.', body: 'You connect Google Takeout and GitHub. It observes patterns, never contents.' },
  { title: 'Every claim cites its source.', body: 'Each observation becomes a claim that says where it came from, and how sure.' },
  { title: 'It lands under your name.', body: 'Committed to food.you.eth — a name you own. Versioned, encrypted, on IPFS.' },
  { title: 'You try another agent.', body: 'Agent B was built by someone else. It has its own key, and asks to read.' },
  { title: 'You grant one namespace.', body: "The namespace key is sealed to Agent B's public key. Nothing else opens." },
  { title: 'Agent B reads the network.', body: "Not Agent A's database, not its API. The name, the bytes, its own key." },
  { title: 'Agent A is deleted.', body: 'The company closes. Its servers, tokens and working copies are gone.' },
  { title: 'Nothing was lost.', body: 'Agent B still knows you. So do you — one signature reads it all back.' },
]

function Card({ x, y, w = 330, h = 118, title, sub, opacity = 1, dashed = false, strong = false, scale = 1 }: {
  x: number; y: number; w?: number; h?: number; title: string; sub: string; opacity?: number; dashed?: boolean; strong?: boolean; scale?: number
}) {
  return (
    <div style={{
      position: 'absolute', left: x - w / 2, top: y - h / 2, width: w, height: h, opacity, transform: `scale(${scale})`,
      borderRadius: 28, background: strong ? ink(0.92) : bg(1), color: strong ? bg(1) : ink(0.95),
      border: dashed ? `2px dashed ${ink(0.35)}` : `1.5px solid ${ink(strong ? 0.9 : 0.14)}`,
      boxShadow: strong ? `0 24px 60px -24px ${ink(0.55)}` : `0 18px 40px -28px ${ink(0.35)}`,
      display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 28px', fontFamily: FONT,
    }}>
      <div style={{ fontSize: 30, letterSpacing: '-0.03em', fontWeight: 500 }}>{title}</div>
      <div style={{ fontSize: 19, marginTop: 8, opacity: 0.6, letterSpacing: '-0.01em' }}>{sub}</div>
    </div>
  )
}

function Scene() {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const scene = Math.min(SCENES - 1, Math.floor(frame / SCENE))
  const local = frame - scene * SCENE
  const since = (s: number) => spring({ frame: frame - s * SCENE, fps, config: { damping: 20, mass: 0.8 } })
  const on = (s: number) => (frame >= s * SCENE ? since(s) : 0)

  // Positions on the right-hand diagram.
  const A = { x: 770, y: 340, w: 270 }
  const N = { x: 1160, y: 340, w: 330 }
  const B = { x: 1560, y: 340, w: 290 }
  const aR = A.x + A.w / 2, nL = N.x - N.w / 2, nR = N.x + N.w / 2, bL = B.x - B.w / 2

  const textIn = interpolate(local, [0, 14], [0, 1], { extrapolateRight: 'clamp' })
  const textOut = interpolate(local, [SCENE - 12, SCENE], [1, 0], { extrapolateLeft: 'clamp' })
  const copy = COPY[scene]!

  const aGone = on(6)
  const bIn = on(3)
  const sealed = on(4)
  const flowAN = frame < 6 * SCENE ? (local % 48) / 48 : -1
  const flowNB = frame >= 5 * SCENE ? (local % 40) / 40 : -1
  const keyT = scene === 4 ? interpolate(local, [10, 60], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) : -1

  const nsLabel = scene < 2 ? 'waiting…' : scene < 4 ? 'private · v3' : 'sealed to Agent B · v3'

  return (
    <AbsoluteFill style={{ background: 'hsl(var(--bg))', fontFamily: FONT }}>
      {/* Left: the words. */}
      <div style={{ position: 'absolute', left: 70, top: 140, width: 500, opacity: Math.min(textIn, textOut), transform: `translateY(${(1 - textIn) * 18}px)` }}>
        <div style={{ fontSize: 18, letterSpacing: '0.14em', color: ink(0.5) }}>{String(scene + 1).padStart(2, '0')} / 08</div>
        <div style={{ fontSize: 66, lineHeight: 0.95, letterSpacing: '-0.05em', marginTop: 22, color: ink(0.95) }}>{copy.title}</div>
        <div style={{ fontSize: 27, lineHeight: 1.25, letterSpacing: '-0.02em', marginTop: 26, color: ink(0.5) }}>{copy.body}</div>
      </div>

      {/* Right: the wires. */}
      <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }}>
        <line x1={aR} y1={A.y} x2={nL} y2={N.y} stroke={ink(0.25 * (1 - aGone) + 0.05)} strokeWidth={2} strokeDasharray="7 8" strokeDashoffset={-frame * 0.7} />
        <line x1={nR} y1={N.y} x2={bL} y2={B.y} stroke={ink(0.9 * sealed + 0.1 * bIn)} strokeWidth={sealed ? 3 : 2} strokeDasharray={sealed ? undefined : '7 8'} opacity={bIn} />
        {flowAN >= 0 ? <circle cx={aR + (nL - aR) * flowAN} cy={A.y} r={6} fill={ink(0.85)} /> : null}
        {flowNB >= 0 ? <circle cx={nR + (bL - nR) * flowNB} cy={N.y} r={7} fill={ink(0.9)} /> : null}
        {keyT >= 0 ? (
          <g transform={`translate(${nR + (bL - nR) * keyT - 18}, ${N.y - 58})`}>
            <rect width={36} height={36} rx={10} fill={ink(0.92)} />
            <g transform="translate(6,6)" fill="none" stroke={bg(1)} strokeWidth={2} strokeLinecap="round"><circle cx={8} cy={14} r={4.5} /><path d="M11.5 10.5L21 1M17 5l2.5 2.5M14.5 7.5L17 10" /></g>
          </g>
        ) : null}
      </svg>

      <Card x={A.x} y={A.y} w={A.w} title="Agent A" sub={scene >= 6 ? 'deleted' : scene === 0 ? 'learning' : 'writes claims'} opacity={1 - aGone * 0.75} dashed={scene >= 6} scale={1 - aGone * 0.06} />
      <Card x={N.x} y={N.y} w={N.w} title="food.you.eth" sub={nsLabel} strong={scene >= 2} />
      <Card x={B.x} y={B.y} w={B.w} title="Agent B" sub={scene < 3 ? 'not here yet' : scene < 4 ? 'asking to read' : scene < 5 ? 'granted' : 'reading'} opacity={0.28 + 0.72 * bIn} dashed={bIn < 0.5} scale={0.96 + 0.04 * bIn} />

      {/* The claim, where it currently is. */}
      {scene >= 1 && scene < 6 ? (
        <div style={{ position: 'absolute', left: A.x - A.w / 2, top: A.y + 90, maxWidth: 420, padding: '12px 18px', borderRadius: 16, background: 'hsl(var(--raised))', fontSize: 19, color: ink(0.7), opacity: on(1) * (1 - aGone) }}>
          Orders from Dishoom · Takeout · 85%
        </div>
      ) : null}
      {scene >= 5 ? (
        <div style={{ position: 'absolute', left: B.x - B.w / 2 - 60, top: B.y + 90, width: B.w + 60, padding: '12px 18px', borderRadius: 16, background: 'hsl(var(--raised))', fontSize: 19, color: ink(0.75), opacity: on(5) }}>
          Orders from Dishoom · Takeout · 85%
        </div>
      ) : null}

      {/* Progress. */}
      <div style={{ position: 'absolute', left: 70, bottom: 60, display: 'flex', gap: 10 }}>
        {Array.from({ length: SCENES }, (_, i) => (
          <div key={i} style={{ width: 54, height: 4, borderRadius: 2, background: ink(0.12), overflow: 'hidden' }}>
            <div style={{ width: `${i < scene ? 100 : i === scene ? (local / SCENE) * 100 : 0}%`, height: '100%', background: ink(0.9) }} />
          </div>
        ))}
      </div>
    </AbsoluteFill>
  )
}

export function ThesisMotion() {
  return (
    <div className="w-full overflow-hidden rounded-[28px] border border-line" role="img" aria-label="Agent A learns and writes claims under your name. You grant Agent B one namespace; its key is sealed to Agent B. Agent B reads from the network. Agent A is deleted, and Agent B still reads.">
      <Player
        component={Scene}
        durationInFrames={SCENE * SCENES}
        fps={30}
        compositionWidth={W}
        compositionHeight={H}
        style={{ width: '100%', aspectRatio: `${W} / ${H}` }}
        autoPlay
        loop
        controls={false}
        clickToPlay={false}
        doubleClickToFullscreen={false}
        spaceKeyToPlayOrPause={false}
        initiallyMuted
      />
    </div>
  )
}
