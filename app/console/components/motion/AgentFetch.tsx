'use client'

/**
 * An agent answering a question from the network, as it happens.
 *
 * Asked → thinking → calls knowledge_search → the name resolves on ENS, the
 * version is fetched from IPFS and verified → the claim arrives fenced as
 * data → the agent answers and cites it. A Remotion composition played in the
 * page, looping, themed through the page's CSS variables.
 *
 * The claim is the one this page's example has always shown; nothing here is
 * invented for the animation.
 */
import { Player } from '@remotion/player'
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'

const W = 1000
const H = 1060
const LOOP = 390

const ink = (a = 1) => `hsl(var(--ink) / ${a})`
const bg = (a = 1) => `hsl(var(--bg) / ${a})`
const SANS = 'var(--font-grotesk), var(--font-sans), sans-serif'
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'

const QUESTION = 'Find vegetarian restaurants in Tokyo'
const ANSWER = 'Try Ain Soph. Journey in Shinjuku — it is fully vegan, with a tasting menu.'
const STEPS = [
  'Resolve japan.travel.user.eth on ENS',
  'Read contenthash → refs, v1',
  'Fetch commits from IPFS',
  'Verify each object by its hash',
]

const typed = (text: string, frame: number, start: number, cps = 1.4) =>
  text.slice(0, Math.max(0, Math.min(text.length, Math.floor((frame - start) * cps))))

function Check({ done }: { done: boolean }) {
  return (
    <div style={{ width: 30, height: 30, borderRadius: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', background: done ? ink(0.92) : 'transparent', border: done ? 'none' : `2px solid ${ink(0.25)}` }}>
      {done ? (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke={bg(1)} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 8.5l3 3 6-7" /></svg>
      ) : null}
    </div>
  )
}

function Scene() {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const rise = (at: number) => spring({ frame: frame - at, fps, config: { damping: 18, mass: 0.7 } })
  const fadeAll = interpolate(frame, [LOOP - 24, LOOP - 4], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

  const T = { ask: 6, think: 44, call: 82, steps: 104, result: 214, answer: 262 }
  const thinking = frame >= T.think && frame < T.call
  const stepDone = (i: number) => frame >= T.steps + i * 26 + 18
  const stepShown = (i: number) => frame >= T.steps + i * 26

  return (
    <AbsoluteFill style={{ background: 'hsl(var(--canvas))', backgroundImage: `radial-gradient(${ink(0.1)} 1.2px, transparent 1.2px)`, backgroundSize: '24px 24px', fontFamily: SANS, opacity: fadeAll }}>
      <div style={{ position: 'absolute', inset: 48, display: 'flex', flexDirection: 'column', gap: 22 }}>
        {/* The question. */}
        <div style={{ alignSelf: 'flex-end', maxWidth: 700, background: ink(0.92), color: bg(1), borderRadius: 26, padding: '20px 28px', fontSize: 30, letterSpacing: '-0.02em', opacity: rise(T.ask), transform: `translateY(${(1 - rise(T.ask)) * 16}px)` }}>
          {typed(QUESTION, frame, T.ask) || ' '}
        </div>

        {/* Thinking. */}
        {frame >= T.think ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, color: ink(0.55), fontSize: 26, opacity: rise(T.think) }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'hsl(var(--raised))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, color: ink(0.8) }}>◈</div>
            {thinking ? (
              <span>Thinking{'.'.repeat(1 + (Math.floor(frame / 8) % 3))}</span>
            ) : (
              <span>Checking your knowledge network</span>
            )}
          </div>
        ) : null}

        {/* The tool call, and what it does. */}
        {frame >= T.call ? (
          <div style={{ background: bg(1), border: `1.5px solid ${ink(0.12)}`, borderRadius: 26, padding: 28, boxShadow: `0 18px 40px -26px ${ink(0.35)}`, opacity: rise(T.call), transform: `translateY(${(1 - rise(T.call)) * 18}px)` }}>
            <div style={{ fontFamily: MONO, fontSize: 24, color: ink(0.9) }}>knowledge_search</div>
            <div style={{ fontFamily: MONO, fontSize: 21, color: ink(0.55), marginTop: 8 }}>namespace: "japan.travel.user.eth"</div>
            <div style={{ fontFamily: MONO, fontSize: 21, color: ink(0.55), marginTop: 4 }}>query: "vegetarian restaurants in Tokyo"</div>
            <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {STEPS.map((s, i) => (
                <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 14, opacity: stepShown(i) ? rise(T.steps + i * 26) : 0 }}>
                  <Check done={stepDone(i)} />
                  <span style={{ fontSize: 24, color: stepDone(i) ? ink(0.85) : ink(0.5) }}>{s}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* What came back: fenced data, with its provenance. */}
        {frame >= T.result ? (
          <div style={{ border: `2px dashed ${ink(0.3)}`, borderRadius: 26, padding: 26, opacity: rise(T.result), transform: `translateY(${(1 - rise(T.result)) * 18}px)` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 19, color: ink(0.5), letterSpacing: '0.04em' }}>
              <span>RETRIEVED DATA · japan.travel.user.eth v1</span>
              <span>3 results</span>
            </div>
            <div style={{ fontSize: 27, color: ink(0.92), marginTop: 12, letterSpacing: '-0.015em', lineHeight: 1.25 }}>Ain Soph. Journey in Shinjuku is fully vegan with a tasting menu</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 14 }}>
              {['tabelog', '90%', 'tokyo.food.eth', 'unreviewed', '+2 more'].map((t) => (
                <span key={t} style={{ fontSize: 19, padding: '5px 12px', borderRadius: 999, background: 'hsl(var(--raised))', color: ink(0.7) }}>{t}</span>
              ))}
            </div>
          </div>
        ) : null}

        {/* The answer, citing it. */}
        {frame >= T.answer ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, opacity: rise(T.answer) }}>
            <div style={{ fontSize: 29, lineHeight: 1.3, color: ink(0.92), letterSpacing: '-0.02em' }}>{typed(ANSWER, frame, T.answer, 1.6)}</div>
            {frame >= T.answer + 52 ? (
              <span style={{ alignSelf: 'flex-start', fontSize: 19, padding: '6px 14px', borderRadius: 999, background: ink(0.92), color: bg(1), opacity: rise(T.answer + 52) }}>
                cited · japan.travel.user.eth v1 · tabelog
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  )
}

export function AgentFetch() {
  return (
    <div className="w-full overflow-hidden rounded-[28px]" role="img" aria-label="An agent is asked for vegetarian restaurants in Tokyo, calls knowledge_search on japan.travel.user.eth, resolves the name on ENS, fetches and verifies the version from IPFS, receives a sourced claim fenced as data, and answers citing it.">
      <Player
        component={Scene}
        durationInFrames={LOOP}
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
