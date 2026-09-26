'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

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
type Turn = { role: 'user' | 'assistant'; content: string; model?: string; purchase?: Purchase | null; usedPaid?: string | null; paidError?: string }

const PROMPTS = [
  'Give me a portfolio report',
  'What did the whales move this week?',
  'What moved in and out of my wallet in the last 30 days?',
  'Where could my idle USDC earn yield on Base?',
  'How do I compare with the wallets I track?',
  'How are the coins I watch doing today?',
]
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
      const body = (await r.json()) as { answer?: string; model?: string; error?: string; purchase?: Purchase | null; paid?: { namespace: string } | null; paidError?: string }
      setTurns((t) => [...t, { role: 'assistant', content: body.answer ?? body.error ?? 'No answer.', ...(body.model ? { model: body.model } : {}), purchase: body.purchase ?? null, usedPaid: body.paid?.namespace ?? null, ...(body.paidError ? { paidError: body.paidError } : {}) }])
      // A purchase changes what Agent B holds; show it.
      if (body.purchase && loaded?.paid) setLoaded({ ...loaded, paid: { ...loaded.paid, holds: true, validUntil: body.purchase.validUntil } })
    } catch { setTurns((t) => [...t, { role: 'assistant', content: 'The request failed.' }]) }
    finally { setBusy(false) }
  }

  const userClaims = loaded?.user.memories.reduce((n, m) => n + m.claims.length, 0) ?? 0
  const tracked = loaded?.wallets.filter((w) => w.role === 'tracked').length ?? 0

  return (
    <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
      {/* What Agent B reads ----------------------------------------------- */}
      <aside className="space-y-4">
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
              detail={`${compact(w.totalUsd)} · ${w.holdings.slice(0, 3).map((h) => h.symbol).join(', ') || 'nothing priced'} · ${w.movements} movements · ${w.via}`} />
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
      <section className="flex h-[calc(100vh-9rem)] min-h-[560px] flex-col rounded-2xl border border-line bg-surface">
        <div className="border-b border-line px-5 py-3">
          <p className="text-[15px] font-semibold">Agent B <span className="ml-1 text-[12.5px] font-normal text-dim">Portfolio Intelligence</span></p>
          <p className="text-[12.5px] text-dim">Inherits treasury.eth, adds your memory, reads Base. Recommends; never signs.</p>
        </div>
        <div ref={scroller} className="flex-1 space-y-5 overflow-y-auto p-5">
          {!turns.length ? (
            <div>
              <p className="text-[14.5px] text-dim">Ask about your holdings, transactions, yield or history. Answers come back as a short report, with every figure cited.</p>
              <div className="mt-4 flex flex-wrap gap-2">{PROMPTS.map((p) => <button key={p} disabled={!loaded} onClick={() => ask(p)} className="rounded-full border border-line px-3 py-1.5 text-left text-[13px] hover:bg-raised disabled:opacity-50">{p}</button>)}</div>
            </div>
          ) : turns.map((t, i) => t.role === 'user' ? (
            <div key={i} className="ml-auto w-fit max-w-[80%] rounded-2xl bg-ink px-4 py-2.5 text-[14.5px] text-bg">{t.content}</div>
          ) : (
            <div key={i} className="max-w-[92%]">
              <Report text={t.content} />
              {t.purchase ? (
                <p className="mt-3 w-fit rounded-xl border border-line px-3 py-2 text-[12.5px]">
                  <span className="font-medium">Bought {t.purchase.namespace} from Agent A</span>
                  <span className="text-dim"> · {t.purchase.amount} {t.purchase.asset} on {NETWORK_NAME[t.purchase.network] ?? t.purchase.network} · grant until {t.purchase.validUntil ? day(t.purchase.validUntil) : 'epoch end'}</span>
                  {t.purchase.tx ? <> · <a href={txUrl(t.purchase.network, t.purchase.tx)} target="_blank" rel="noreferrer" className="font-mono underline">{t.purchase.tx.slice(0, 10)}…</a></> : null}
                </p>
              ) : t.usedPaid ? <p className="mt-2 text-[11.5px] text-dim">read {t.usedPaid} with Agent B&apos;s existing grant</p> : null}
              {t.paidError ? <p className="mt-2 text-[11.5px] text-removed">Could not buy whale flows: {t.paidError}</p> : null}
              {t.model ? <p className="mt-2 text-[11.5px] text-dim">answered by {t.model}</p> : null}
            </div>
          ))}
          {busy ? <p className="text-[13.5px] text-dim">Reading treasury.eth, your memory and Base{/whale|flow|mov|transfer|week/i.test(turns.at(-1)?.content ?? '') && !loaded?.paid?.holds ? ', and buying whale flows from Agent A over x402' : ''}…</p> : null}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); void ask(q) }} className="flex gap-2 border-t border-line p-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} disabled={!loaded} placeholder={loaded ? 'Ask Agent B…' : 'Loading…'} className="min-w-0 flex-1 rounded-xl border border-line bg-raised/50 px-3 py-2 text-[14.5px] outline-none focus:border-accent/50 disabled:opacity-60" />
          <button disabled={busy || !q.trim() || !loaded} className="rounded-xl bg-ink px-4 py-2 text-[13.5px] text-bg disabled:opacity-40">Ask</button>
        </form>
      </section>
    </div>
  )
}

/** The answer as a report: "## " starts a section, "• " a point, and [citations] recede. */
function Report({ text }: { text: string }) {
  const cite = (s: string) => s.split(/(\[[^\]]+\])/g).map((p, i) => (p.startsWith('[') && p.endsWith(']') ? <span key={i} className="text-[12px] text-dim">{p}</span> : p))
  return (
    <div className="space-y-1.5 text-[14.5px] leading-relaxed">
      {text.split('\n').filter((l) => l.trim()).map((l, i) => {
        const line = l.trim()
        if (line.startsWith('## ')) return <p key={i} className="pt-2 text-[12px] font-medium uppercase tracking-[0.08em] text-dim">{line.slice(3)}</p>
        if (line.startsWith('• ')) return <p key={i} className="flex gap-2 pl-1"><span className="text-dim">•</span><span>{cite(line.slice(2))}</span></p>
        return <p key={i} className={i === 0 ? 'text-[15.5px] font-medium' : ''}>{cite(line)}</p>
      })}
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

function Row({ ok, title, detail }: { ok: boolean; title: React.ReactNode; detail: string }) {
  return (
    <div className="mt-3 flex gap-2.5">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${ok ? 'bg-ink' : 'border border-line'}`} aria-hidden />
      <div className="min-w-0"><p>{title}</p><p className="text-[12.5px] text-dim">{detail}</p></div>
    </div>
  )
}
