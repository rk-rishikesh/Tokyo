/**
 * The thesis in eight frames: one agent learns, a different one reads, the
 * first one dies, and nothing is lost.
 *
 * CSS only — each frame holds for four seconds of a 32-second loop, so it
 * plays before hydration and costs nothing. With reduced motion the frames lay
 * out as a grid instead, which reads as the same story in order.
 *
 * Every claim shown is one this product's readers actually produce, from
 * sources that actually connect.
 */
type Frame = { step: string; title: string; body: string; scene: { a: string; ns: string; b: string; note: string } }

const FRAMES: Frame[] = [
  { step: '01', title: 'agent a learns', body: 'You connect Google Takeout and GitHub. Agent A observes patterns, never contents.', scene: { a: '🤖 A · learning', ns: '—', b: '', note: 'orders from Dishoom · writes TypeScript' } },
  { step: '02', title: 'every claim cites its source', body: 'Each observation becomes a claim that says where it came from and how sure it is.', scene: { a: '🤖 A', ns: 'claim · Takeout · 85%', b: '', note: 'proposed → reviewed → committed' } },
  { step: '03', title: 'it lands under your name', body: 'Claims are committed to food.you.eth — a name you own — versioned, encrypted, on IPFS.', scene: { a: '🤖 A', ns: '🔒 food.you.eth · v3', b: '', note: 'contenthash → refs → commits' } },
  { step: '04', title: 'you try a different agent', body: 'Agent B was built by someone else. It has its own key, and asks to read your memory.', scene: { a: '🤖 A', ns: '🔒 food.you.eth', b: '🧩 B · asking', note: 'request: read food.you.eth' } },
  { step: '05', title: 'you grant one namespace', body: "food.you.eth's key is sealed to Agent B's public key. work.you.eth stays ciphertext to it.", scene: { a: '🤖 A', ns: '🔐 food.you.eth', b: '🧩 B · granted', note: 'sealed key published in knowledge.access' } },
  { step: '06', title: 'agent b reads the network', body: "Not Agent A's database, not its API. The name, the bytes, and its own key.", scene: { a: '🤖 A', ns: '🔐 food.you.eth', b: '🧩 B · reading', note: 'orders from Dishoom — Takeout · 85%' } },
  { step: '07', title: 'agent a is deleted', body: 'The company closes. Its servers, tokens and working copies are gone.', scene: { a: '✕ A · deleted', ns: '🔐 food.you.eth', b: '🧩 B', note: 'rm -rf ~/.recall' } },
  { step: '08', title: 'nothing was lost', body: 'Agent B still knows you. So do you — one wallet signature reads it all back.', scene: { a: '', ns: '🔐 food.you.eth · v3', b: '🧩 B · still reading', note: 'your agents change. your knowledge doesn’t.' } },
]

function Scene({ s, dead }: { s: Frame['scene']; dead: boolean }) {
  return (
    <div className="mt-6 grid grid-cols-3 items-center gap-3 text-center text-[14px]">
      <div className={`rounded-2xl border px-3 py-4 ${dead ? 'border-dashed border-removed/50 text-removed' : 'border-line bg-surface'} ${s.a ? '' : 'invisible'}`}>{s.a || '·'}</div>
      <div className="rounded-2xl border border-accent/40 bg-accent-soft px-3 py-4 font-mono text-[13.5px]">{s.ns}</div>
      <div className={`rounded-2xl border border-line bg-surface px-3 py-4 ${s.b ? '' : 'invisible'}`}>{s.b || '·'}</div>
      <p className="col-span-3 mt-1 font-mono text-[13px] text-dim">{s.note}</p>
    </div>
  )
}

export function Thesis() {
  return (
    <div className="kn-thesis relative mx-auto max-w-3xl">
      <div className="kn-thesis-stage relative min-h-[330px]">
        {FRAMES.map((f, i) => (
          <div key={f.step} className="kn-thesis-frame rounded-3xl border border-line bg-raised/40 p-7" style={{ animationDelay: `${i * 4}s` }}>
            <p className="font-mono text-[12.5px] tracking-[0.16em] text-dim">{f.step} / 08</p>
            <p className="mt-2 font-display text-[clamp(1.6rem,3.4vw,2.4rem)] lowercase leading-[1] tracking-[-0.03em]">{f.title}</p>
            <p className="mt-2 max-w-xl text-[14.5px] leading-relaxed text-dim">{f.body}</p>
            <Scene s={f.scene} dead={f.step === '07'} />
          </div>
        ))}
      </div>
      <div className="kn-thesis-dots mt-4 flex justify-center gap-1.5" aria-hidden>
        {FRAMES.map((f, i) => <span key={f.step} className="kn-thesis-dot h-1.5 w-6 rounded-full bg-line" style={{ animationDelay: `${i * 4}s` }} />)}
      </div>
    </div>
  )
}
