'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { CitedPills, PendingTrace, Reads, splitCitations, UserBubble, type TraceCall } from '@/components/chat/AgentTrace'

type Claim = { id: string; subject: string | null; claim: string; topic: string | null; sources: string[]; contributor: string }
type Memory = { namespace: string; version: number; claims: Claim[] }
type Wallet = { role: 'yours' | 'tracked'; label: string; address: string; via: string; totalUsd: number; holdings: { symbol: string; usd: number }[]; movements: number }
type Loaded = {
  treasury: Memory | null
  user: { name: string | null; owner: string | null; memories: Memory[]; unreadable: { namespace: string; reason: string }[]; watchCoins: string[] }
  wallets: Wallet[]
  walletErrors: { input: string; error: string }[]
  paid: Paid | null
}
type Paid = { namespace: string; price: string | null; network: string | null; payTo: string | null; epochDays: number | null; holds: boolean; validUntil: string | null; buyer: string | null }
type Purchase = { namespace: string; amount: string; asset: string; network: string; tx: string | null; validUntil: string }
type Turn = { role: 'user' | 'assistant'; content: string; model?: string; purchase?: Purchase | null; usedPaid?: string | null; paidError?: string; trace?: TraceCall[]; versions?: Record<string, number> }

/** Questions to start from — each names what Agent B will read to answer it. */
const PROMPTS: { q: string; reads: string }[] = [
  { q: 'What should I buy, sell or hold right now?', reads: 'Holdings · playbook · whale flows' },
  { q: 'Give me a portfolio report', reads: 'Holdings · treasury.eth' },
  { q: 'What did the whales move this week?', reads: 'signals.treasury.eth · paid tier' },
  { q: 'Where could my idle USDC earn yield on Base?', reads: 'Yields in treasury.eth' },
  { q: 'Am I inside my playbook limits?', reads: 'Runway · concentration · gas reserve' },
  { q: 'How do I compare with the wallets I track?', reads: 'Your memory · Base wallets' },
]
/** After an answer, fewer and shorter: the next thing worth asking. */
const FOLLOW_UPS = ['What should I buy, sell or hold?', 'What did the whales move this week?', 'Where could my idle USDC earn?', 'Am I inside my playbook limits?']
const DEMO_MEMORY = 'personal.eth'
const NETWORK_NAME: Record<string, string> = { 'eip155:84532': 'Base Sepolia', 'eip155:8453': 'Base' }
const txUrl = (network: string, tx: string) => `${network === 'eip155:8453' ? 'https://basescan.org' : 'https://sepolia.basescan.org'}/tx/${tx}`
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
const compact = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `$${(n / 1e3).toFixed(0)}k` : usd(n))
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const topics = (m: Memory) => [...new Set(m.claims.map((c) => c.topic).filter(Boolean))].join(', ')

export function TreasuryChat({ initialName, initialWallets }: { initialName: string; initialWallets: string[] }) {
  const [name, setName] = useState(initialName)
  const [wallets, setWallets] = useState<string[]>(initialWallets)
  const [draftWallet, setDraftWallet] = useState('')
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [turns, setTurns] = useState<Turn[]>([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight }, [turns, busy])
  // Agent B starts with what it inherits; your memory is added on top.
  const started = useRef(false)
  useEffect(() => { if (!started.current) { started.current = true; void load(initialName, initialWallets) } }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function load(n = name, w = wallets) {
    setLoading(true); setError(null)
    try {
      const r = await fetch('/api/onchain/context', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: n.trim() || null, wallets: w }) })
      const body = (await r.json()) as Loaded & { error?: string }
      if (!r.ok) throw new Error(body.error ?? 'could not load')
      setLoaded(body)
    } catch (e) { setError(e instanceof Error ? e.message : 'could not load') }
    finally { setLoading(false) }
  }

  const addWallet = (v: string) => {
    const a = v.trim()
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) { setError('Paste a Base address (0x…).'); return }
    if (wallets.some((x) => x.toLowerCase() === a.toLowerCase()) || wallets.length >= 3) return
    const next = [...wallets, a]
    setWallets(next); setDraftWallet('')
    void load(name, next)
  }
  const tryMemory = (n: string) => { setName(n); void load(n, wallets) }

  async function ask(text: string) {
    const question = text.trim()
    if (!question || busy || !loaded) return
    const history = turns.map(({ role, content }) => ({ role, content }))
    setTurns((t) => [...t, { role: 'user', content: question }]); setQ(''); setBusy(true)
    try {
      const r = await fetch('/api/onchain/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question, name: loaded.user.name, wallets, history }) })
      const body = (await r.json()) as { answer?: string; model?: string; error?: string; purchase?: Purchase | null; paid?: { namespace: string } | null; paidError?: string; trace?: TraceCall[]; versions?: Record<string, number> }
      setTurns((t) => [...t, { role: 'assistant', content: body.answer ?? body.error ?? 'No answer.', ...(body.model ? { model: body.model } : {}), purchase: body.purchase ?? null, usedPaid: body.paid?.namespace ?? null, ...(body.paidError ? { paidError: body.paidError } : {}), ...(body.trace ? { trace: body.trace } : {}), ...(body.versions ? { versions: body.versions } : {}) }])
      // A purchase changes what Agent B holds; show it.
      if (body.purchase && loaded?.paid) setLoaded({ ...loaded, paid: { ...loaded.paid, holds: true, validUntil: body.purchase.validUntil } })
    } catch { setTurns((t) => [...t, { role: 'assistant', content: 'The request failed.' }]) }
    finally { setBusy(false) }
  }

  const userClaims = loaded?.user.memories.reduce((n, m) => n + m.claims.length, 0) ?? 0
  const tracked = loaded?.wallets.filter((w) => w.role === 'tracked').length ?? 0

  return (
    <div className="grid gap-6 lg:h-[calc(100vh-61px-5rem)] lg:grid-cols-[360px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">
      {/* What Agent B reads ----------------------------------------------- */}
      <aside className="space-y-4 lg:min-h-0 lg:overflow-y-auto lg:pb-2">
        <Link href={`/demo/onchain${initialWallets[0] ? `?wallet=${initialWallets[0]}` : ''}`} className="text-[13.5px] text-dim hover:text-ink">← Dashboard</Link>

        <section className="rounded-2xl border border-line bg-surface p-5 text-[13.5px]">
          <Step n={1} title="Inherited memory" hint="always read" />
          <Row ok={!!loaded?.treasury} title={<Link href="/k/treasury.eth" className="font-mono underline decoration-line underline-offset-2 hover:decoration-ink">treasury.eth</Link>}
            detail={loaded?.treasury ? `v${loaded.treasury.version} · ${loaded.treasury.claims.length} claims by Agent A: ${topics(loaded.treasury)}` : loading ? 'reading…' : 'could not be read'} />
        </section>

        <section className="rounded-2xl border border-line bg-surface p-5 text-[13.5px]">
          <Step n={2} title="Your memory" hint="optional" />
          <p className="mt-1 text-[13px] text-dim">An ENS name on Sepolia. Its claims tell Agent B which wallets are yours, which to track, which coins you watch and how you like to invest.</p>
          <form onSubmit={(e) => { e.preventDefault(); void load() }} className="mt-3 flex gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="yourname.eth" spellCheck={false} className="min-w-0 flex-1 rounded-xl border border-line bg-raised/50 px-3 py-2 font-mono text-[14px] outline-none focus:border-accent/50" />
            <button disabled={loading} className="rounded-xl bg-ink px-4 py-2 text-[13.5px] text-bg disabled:opacity-50">{loading ? 'Loading…' : 'Load'}</button>
          </form>
          {!loaded?.user.name ? <p className="mt-2 text-[13px] text-dim">No name yet? Try <button onClick={() => tryMemory(DEMO_MEMORY)} className="font-mono text-ink underline">{DEMO_MEMORY}</button></p> : null}
          {loaded?.user.name ? (
            <>
              <Row ok={userClaims > 0} title={<span className="font-mono">{loaded.user.name}</span>} detail={userClaims ? loaded.user.memories.map((m) => `${m.namespace} v${m.version} · ${m.claims.length} claims`).join(' · ') : 'no readable memory under this name yet'} />
              {userClaims ? <p className="mt-1 pl-[18px] text-[12.5px] text-dim">Tracks {tracked} wallet{tracked === 1 ? '' : 's'}{loaded.user.watchCoins.length ? ` · watches ${loaded.user.watchCoins.join(', ')}` : ''}</p> : null}
              {loaded.user.unreadable.length ? <p className="mt-1 pl-[18px] text-[12.5px] text-dim">Encrypted, no key here: {loaded.user.unreadable.map((u) => u.namespace).join(', ')}</p> : null}
              {!userClaims ? <p className="mt-2 text-[12.5px] text-dim">Build memory under your name with <Link href="/app" className="underline">Owned Instinct</Link>, then load it again.</p> : null}
            </>
          ) : null}
        </section>

        <section className="rounded-2xl border border-line bg-surface p-5 text-[13.5px]">
          <Step n={3} title="Wallets on Base" hint="read live" />
          {loaded?.wallets.map((w) => (
            <Row key={w.address} ok title={<span><span className="font-medium">{w.label}</span> <span className={`ml-1 rounded px-1.5 py-px text-[11px] ${w.role === 'yours' ? 'bg-ink text-bg' : 'border border-line text-dim'}`}>{w.role === 'yours' ? 'yours' : 'tracked'}</span></span>}
              detail={`${compact(w.totalUsd)} · ${w.holdings.slice(0, 3).map((h) => h.symbol).join(', ') || 'nothing priced'} · ${w.movements} movements · ${w.via}`}
              extra={
                <p className="mt-1.5 text-[12px] text-dim">
                  {w.via === 'demo wallet' ? <span className="mr-1">Connected demo address</span> : null}
                  <a href={`https://basescan.org/address/${w.address}`} target="_blank" rel="noreferrer" className="break-all font-mono text-[10.5px] tracking-tight text-ink/80 underline decoration-line underline-offset-2 hover:text-ink">{w.address}</a>
                </p>
              } />
          ))}
          {loaded?.walletErrors.map((e) => <Row key={e.input} ok={false} title={<span className="font-mono">{e.input}</span>} detail={e.error} />)}
          {!loaded && loading ? <p className="mt-2 text-dim">Reading through MultiBaas…</p> : null}
          <form onSubmit={(e) => { e.preventDefault(); addWallet(draftWallet) }} className="mt-3 flex gap-2">
            <input value={draftWallet} onChange={(e) => setDraftWallet(e.target.value)} placeholder="Add your Base wallet 0x…" spellCheck={false} className="min-w-0 flex-1 rounded-xl border border-line bg-raised/50 px-3 py-1.5 font-mono text-[13px] outline-none focus:border-accent/50" />
            <button type="submit" className="rounded-xl border border-line px-3 py-1.5 text-[13px] hover:bg-raised">Add</button>
          </form>
          {error ? <p className="mt-3 text-[13px] text-removed">{error}</p> : null}
        </section>

        {loaded?.paid ? (
          <section className="rounded-2xl border border-line bg-surface p-5 text-[13.5px]">
            <Step n={4} title="Paid memory" hint="bought over x402" />
            <Row ok={loaded.paid.holds} title={<Link href={`/k/${loaded.paid.namespace}`} className="font-mono underline decoration-line underline-offset-2 hover:decoration-ink">{loaded.paid.namespace}</Link>}
              detail={`Sealed. Agent A's 7-day whale flows · ${loaded.paid.price ?? '—'} USDC per ${loaded.paid.epochDays ?? 7}-day epoch on ${NETWORK_NAME[loaded.paid.network ?? ''] ?? loaded.paid.network}`} />
            <p className="mt-2 pl-[18px] text-[12.5px] text-dim">{loaded.paid.holds
              ? `Agent B holds a grant until ${loaded.paid.validUntil ? day(loaded.paid.validUntil) : 'the epoch ends'}, sealed to its own key.`
              : 'Agent B buys it when a question needs whale flows — cheaper than watching every transfer itself.'}</p>
          </section>
        ) : null}
      </aside>

      {/* Portfolio Intelligence ------------------------------------------- */}
      <section className="flex h-[calc(100vh-61px-5rem)] min-h-[480px] flex-col lg:h-auto lg:min-h-0">
        <div className="px-1 pb-4">
          <p className="text-[15px] font-semibold">Agent B <span className="ml-1 text-[12.5px] font-normal text-dim">Portfolio Intelligence</span></p>
          <p className="text-[12.5px] text-dim">Inherits treasury.eth, adds your memory, reads Base. Recommends; never signs.</p>
        </div>
        <div ref={scroller} className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-1 pb-6">
          {!turns.length ? (
            <div className="pt-2">
              <p className="font-display text-[1.7rem] leading-tight">What should Agent B look at?</p>
              <p className="mt-1 max-w-xl text-[14px] text-dim">Holdings, transactions, yield and whale activity — answered as a short report with every figure cited, and suggested moves that stay inside your playbook.</p>
              <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
                {PROMPTS.map((p, i) => (
                  <button key={p.q} disabled={!loaded} onClick={() => ask(p.q)}
                    className={`group rounded-2xl border p-4 text-left transition-colors disabled:opacity-50 ${i === 0 ? 'border-ink/25 bg-surface hover:border-ink/45' : 'border-line hover:bg-raised'}`}>
                    <span className="block text-[14.5px] font-medium leading-snug">{p.q}</span>
                    <span className="mt-1.5 block text-[12px] text-dim">{p.reads}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : turns.map((t, i) => t.role === 'user' ? (
            <UserBubble key={i}>{t.content}</UserBubble>
          ) : (
            <div key={i} className="max-w-[92%] space-y-4">
              {t.trace?.length ? <Reads trace={t.trace} open={i === turns.length - 1} /> : null}
              <Answer text={t.content} versions={t.versions} />
              {t.purchase ? (
                <p className="mt-3 w-fit rounded-xl border border-line px-3 py-2 text-[12.5px]">
                  <span className="font-medium">Bought {t.purchase.namespace} from Agent A</span>
                  <span className="text-dim"> · {t.purchase.amount} {t.purchase.asset} on {NETWORK_NAME[t.purchase.network] ?? t.purchase.network} · grant until {t.purchase.validUntil ? day(t.purchase.validUntil) : 'epoch end'}</span>
                  {t.purchase.tx ? <> · <a href={txUrl(t.purchase.network, t.purchase.tx)} target="_blank" rel="noreferrer" className="font-mono underline">{t.purchase.tx.slice(0, 10)}…</a></> : null}
                </p>
              ) : t.usedPaid ? <p className="mt-2 text-[11.5px] text-dim">read {t.usedPaid} with Agent B&apos;s existing grant</p> : null}
              {t.paidError ? <p className="mt-2 text-[11.5px] text-removed">Could not buy whale flows: {t.paidError}</p> : null}
              {t.model ? <p className="mt-2 text-[11.5px] text-dim">answered by {t.model}</p> : null}
              {i === turns.length - 1 && !busy ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  {FOLLOW_UPS.filter((f) => f !== turns[i - 1]?.content).slice(0, 3).map((f) => (
                    <button key={f} onClick={() => ask(f)} className="rounded-full border border-line px-3 py-1.5 text-[12.5px] hover:bg-raised">{f}</button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
          {busy ? <div className="max-w-[92%]"><PendingTrace namespace="treasury.eth" query={turns.at(-1)?.content ?? ''} /></div> : null}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); void ask(q) }} className="flex gap-2 rounded-2xl border border-line bg-surface p-2 shadow-[0_16px_40px_-28px_hsl(var(--ink)/0.45)]">
          <input value={q} onChange={(e) => setQ(e.target.value)} disabled={!loaded} placeholder={loaded ? 'Ask Agent B…' : 'Loading…'} className="min-w-0 flex-1 rounded-xl bg-transparent px-3 py-2 text-[14.5px] outline-none focus:border-accent/50 disabled:opacity-60" />
          <button disabled={busy || !q.trim() || !loaded} className="rounded-xl bg-ink px-4 py-2 text-[13.5px] text-bg disabled:opacity-40">Ask</button>
        </form>
      </section>
    </div>
  )
}

/** The answer, its citations lifted out of the text into pills under it. */
function Answer({ text, versions }: { text: string; versions?: Record<string, number> }) {
  const { text: clean, cites } = splitCitations(text, versions)
  return <div className="space-y-3"><Report text={clean} /><CitedPills cites={cites} /></div>
}

/** The answer as a report: "## " starts a section, "• " a point; "Suggested moves" becomes a card. */
function Report({ text }: { text: string }) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const at = lines.findIndex((l) => /^##\s*suggested moves/i.test(l))
  const body = at < 0 ? lines : lines.slice(0, at)
  const rest = at < 0 ? [] : lines.slice(at + 1)
  // Moves run until the next section; the disclaimer line, if any, is kept for the card's footer.
  const end = rest.findIndex((l) => l.startsWith('## '))
  const moveLines = end < 0 ? rest : rest.slice(0, end)
  const after = end < 0 ? [] : rest.slice(end)
  return (
    <div className="space-y-3">
      <Lines lines={body} lead />
      {at >= 0 ? <Moves lines={moveLines} /> : null}
      {after.length ? <Lines lines={after} /> : null}
    </div>
  )
}

function Lines({ lines, lead }: { lines: string[]; lead?: boolean }) {
  return (
    <div className="space-y-1.5 text-[14.5px] leading-relaxed">
      {lines.map((line, i) => {
        if (line.startsWith('## ')) return <p key={i} className="pt-2 text-[12px] font-medium uppercase tracking-[0.08em] text-dim">{line.slice(3)}</p>
        if (line.startsWith('• ')) return <p key={i} className="flex gap-2 pl-1"><span className="text-dim">•</span><span>{line.slice(2)}</span></p>
        return <p key={i} className={lead && i === 0 ? 'text-[17px] leading-snug tracking-[-0.01em]' : ''}>{line}</p>
      })}
    </div>
  )
}

const ACTIONS = ['Hold', 'Buy', 'Add', 'Trim', 'Sell', 'Stake', 'Earn', 'Watch'] as const
type Action = (typeof ACTIONS)[number]
const TONE: Record<Action, string> = {
  Buy: 'bg-added-bg text-added', Add: 'bg-added-bg text-added',
  Sell: 'bg-removed-bg text-removed', Trim: 'bg-removed-bg text-removed',
  Stake: 'bg-accent-soft text-accent', Earn: 'bg-accent-soft text-accent',
  Watch: 'bg-warn-bg text-warn', Hold: 'bg-raised text-ink',
}

/** "Earn — USDC, $1,728 — reason" → action, what, why. Lines that do not parse stay as text. */
function parseMove(line: string): { action: Action; what: string; why: string } | null {
  const m = line.replace(/^•\s*/, '').match(/^(Hold|Buy|Add|Trim|Sell|Stake|Earn|Watch)\b\s*[—–:-]?\s*(.*)$/i)
  if (!m) return null
  const action = (m[1]![0]!.toUpperCase() + m[1]!.slice(1).toLowerCase()) as Action
  const [what, ...why] = m[2]!.split(/\s+[—–]\s+/)
  return { action, what: (what ?? '').trim(), why: why.join(' — ').trim() }
}

function Moves({ lines }: { lines: string[] }) {
  const moves = lines.map((l) => ({ l, m: parseMove(l) }))
  const notes = moves.filter((x) => !x.m).map((x) => x.l.replace(/^•\s*/, ''))
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-3">
        <p className="text-[13px] font-semibold">Suggested moves</p>
        <p className="text-[11.5px] text-dim">inside your playbook · you decide</p>
      </div>
      <ul className="divide-y divide-line">
        {moves.filter((x) => x.m).map(({ m }, i) => (
          <li key={i} className="flex gap-3 px-4 py-3">
            <span className={`h-fit w-[4.25rem] shrink-0 rounded-lg px-2 py-1 text-center text-[12px] font-semibold ${TONE[m!.action]}`}>{m!.action}</span>
            <div className="min-w-0 text-[14px] leading-snug">
              <p className="font-medium">{m!.what}</p>
              {m!.why ? <p className="mt-0.5 text-[13px] text-dim">{m!.why}</p> : null}
            </div>
          </li>
        ))}
      </ul>
      {notes.length ? <p className="border-t border-line px-4 py-2.5 text-[11.5px] text-dim">{notes.join(' ')}</p> : null}
    </div>
  )
}

function Step({ n, title, hint }: { n: number; title: string; hint: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <h2 className="text-[15px] font-semibold"><span className="mr-2 font-mono text-[12.5px] text-dim">{n}</span>{title}</h2>
      <span className="text-[12px] text-dim">{hint}</span>
    </div>
  )
}

function Row({ ok, title, detail, extra }: { ok: boolean; title: React.ReactNode; detail: string; extra?: React.ReactNode }) {
  return (
    <div className="mt-3 flex gap-2.5">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${ok ? 'bg-ink' : 'border border-line'}`} aria-hidden />
      <div className="min-w-0"><p>{title}</p><p className="text-[12.5px] text-dim">{detail}</p>{extra}</div>
    </div>
  )
}
