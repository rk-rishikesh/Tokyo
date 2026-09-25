'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

type Claim = { id: string; subject: string | null; claim: string; topic: string | null; sources: string[]; contributor: string }
type Memory = { namespace: string; version: number; claims: Claim[] }
type Loaded = {
  treasury: Memory | null
  user: { name: string; owner: string | null; memories: Memory[]; unreadable: { namespace: string; reason: string }[] }
  wallets: { address: string; ens: string | null; totalUsd: number; holdings: { symbol: string; usd: number }[]; movements: number }[]
  walletErrors: { input: string; error: string }[]
}
type Turn = { role: 'user' | 'assistant'; content: string; model?: string }

const PROMPTS = [
  'Apply the treasury playbook to my wallets. What should I do?',
  'How does my stablecoin share compare with the watched treasuries?',
  'What did the watched treasuries move out this month?',
  'What is my largest position worth at today’s ETH price?',
  'What do you know about me from my own memory?',
]

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

declare global {
  interface Window { ethereum?: { request: (a: { method: string }) => Promise<unknown> } }
}

export function TreasuryChat({ initialName }: { initialName: string }) {
  const [name, setName] = useState(initialName)
  const [wallets, setWallets] = useState<string[]>([])
  const [draftWallet, setDraftWallet] = useState('')
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [turns, setTurns] = useState<Turn[]>([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight }, [turns, busy])
  const started = useRef(false)
  useEffect(() => { if (!started.current && initialName) { started.current = true; void load(initialName, []) } }, [initialName]) // eslint-disable-line react-hooks/exhaustive-deps

  async function load(n = name, w = wallets) {
    if (!n.trim()) { setError('Enter your ENS name first.'); return }
    setLoading(true); setError(null)
    try {
      const r = await fetch('/api/onchain/context', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: n, wallets: w }) })
      const body = (await r.json()) as Loaded & { error?: string }
      if (!r.ok) throw new Error(body.error ?? 'could not load')
      setLoaded(body)
    } catch (e) { setError(e instanceof Error ? e.message : 'could not load') }
    finally { setLoading(false) }
  }

  const addWallet = (v: string) => {
    const a = v.trim()
    if (!a || wallets.some((x) => x.toLowerCase() === a.toLowerCase()) || wallets.length >= 4) return
    const next = [...wallets, a]
    setWallets(next); setDraftWallet('')
    if (loaded) void load(name, next)
  }
  async function browserWallet() {
    if (!window.ethereum) { setError('No browser wallet found — paste an address instead.'); return }
    try { const accounts = (await window.ethereum.request({ method: 'eth_requestAccounts' })) as string[]; accounts.slice(0, 1).forEach(addWallet) }
    catch { setError('The wallet did not share an account.') }
  }

  async function ask(text: string) {
    const question = text.trim()
    if (!question || busy || !loaded) return
    const history = turns.map(({ role, content }) => ({ role, content }))
    setTurns((t) => [...t, { role: 'user', content: question }]); setQ(''); setBusy(true)
    try {
      const r = await fetch('/api/onchain/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question, name: loaded.user.name, wallets, history }) })
      const body = (await r.json()) as { answer?: string; model?: string; error?: string }
      setTurns((t) => [...t, { role: 'assistant', content: body.answer ?? body.error ?? 'No answer.', ...(body.model ? { model: body.model } : {}) }])
    } catch { setTurns((t) => [...t, { role: 'assistant', content: 'The request failed.' }]) }
    finally { setBusy(false) }
  }

  const userClaims = loaded?.user.memories.reduce((n, m) => n + m.claims.length, 0) ?? 0

  return (
    <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
      {/* What Agent B reads ----------------------------------------------- */}
      <aside className="space-y-4">
        <Link href="/demo/onchain" className="text-[13.5px] text-dim hover:text-ink">← How it works</Link>
        <section className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-[15px] font-semibold">Bring your memory</h2>
          <p className="mt-1 text-[13px] text-dim">Your ENS name on Sepolia. Agent B reads the memory under it and the wallet that owns it.</p>
          <form onSubmit={(e) => { e.preventDefault(); void load() }} className="mt-3 flex gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="yourname.eth" className="min-w-0 flex-1 rounded-xl border border-line bg-raised/50 px-3 py-2 font-mono text-[14px] outline-none focus:border-accent/50" />
            <button disabled={loading} className="rounded-xl bg-ink px-4 py-2 text-[13.5px] text-bg disabled:opacity-50">{loading ? 'Loading…' : 'Load'}</button>
          </form>
          <p className="mt-3 text-[13px] text-dim">Add a mainnet wallet <span className="text-dim/80">(optional)</span></p>
          <form onSubmit={(e) => { e.preventDefault(); addWallet(draftWallet) }} className="mt-1.5 flex gap-2">
            <input value={draftWallet} onChange={(e) => setDraftWallet(e.target.value)} placeholder="0x… or name.eth" className="min-w-0 flex-1 rounded-xl border border-line bg-raised/50 px-3 py-1.5 font-mono text-[13px] outline-none focus:border-accent/50" />
            <button type="submit" className="rounded-xl border border-line px-3 py-1.5 text-[13px] hover:bg-raised">Add</button>
          </form>
          <button onClick={browserWallet} className="mt-2 text-[13px] text-dim underline hover:text-ink">Use my browser wallet</button>
          {wallets.length ? <ul className="mt-2 flex flex-wrap gap-1.5">{wallets.map((w) => <li key={w} className="rounded-full border border-line px-2.5 py-0.5 font-mono text-[12px]">{w.startsWith('0x') ? short(w) : w}</li>)}</ul> : null}
          {error ? <p className="mt-3 text-[13px] text-removed">{error}</p> : null}
        </section>

        {loaded ? (
          <section className="rounded-2xl border border-line bg-surface p-5 text-[13.5px]">
            <h2 className="text-[15px] font-semibold">What Agent B read</h2>
            <Row ok={!!loaded.treasury} title={<span className="font-mono">treasury.eth</span>} detail={loaded.treasury ? `v${loaded.treasury.version} · ${loaded.treasury.claims.length} claims from Agent A and the playbook` : 'could not be read'} />
            <Row ok={userClaims > 0} title={<span className="font-mono">{loaded.user.name}</span>} detail={userClaims ? loaded.user.memories.map((m) => `${m.namespace} v${m.version} · ${m.claims.length}`).join(' · ') : 'no readable memory under this name yet'} />
            {loaded.user.unreadable.length ? <p className="mt-1 pl-6 text-[12.5px] text-dim">Encrypted, no key here: {loaded.user.unreadable.map((u) => u.namespace).join(', ')}</p> : null}
            {loaded.wallets.map((w) => (
              <Row key={w.address} ok title={<span className="font-mono">{w.ens ?? short(w.address)}</span>} detail={`${usd(w.totalUsd)} on mainnet · ${w.holdings.slice(0, 3).map((h) => h.symbol).join(', ') || 'no priced holdings'}`} />
            ))}
            {loaded.walletErrors.map((e) => <Row key={e.input} ok={false} title={<span className="font-mono">{e.input.startsWith('0x') ? short(e.input) : e.input}</span>} detail={e.error} />)}
            {!userClaims ? <p className="mt-3 text-[12.5px] text-dim">Build memory under your name with <Link href="/app" className="underline">Owned Instinct</Link>, then load it again.</p> : null}
          </section>
        ) : null}
      </aside>

      {/* Agent B ----------------------------------------------------------- */}
      <section className="flex h-[calc(100vh-9rem)] min-h-[520px] flex-col rounded-2xl border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <div>
            <p className="text-[15px] font-semibold">Agent B · treasury agent</p>
            <p className="text-[12.5px] text-dim">Reads treasury.eth, your memory and your wallets. Recommends; never signs.</p>
          </div>
        </div>
        <div ref={scroller} className="flex-1 space-y-4 overflow-y-auto p-5">
          {!loaded ? (
            <p className="text-[14.5px] text-dim">Load your ENS name on the left to give Agent B your memory. No name yet? Try <button onClick={() => { setName('rishhtokyo.eth'); void load('rishhtokyo.eth', wallets) }} className="font-mono text-ink underline">rishhtokyo.eth</button>, and add <button onClick={() => addWallet('vitalik.eth')} className="font-mono text-ink underline">vitalik.eth</button> as a wallet to have something to hold.</p>
          ) : !turns.length ? (
            <div>
              <p className="text-[14.5px] text-dim">Ask about your holdings, transactions, yield or history — or what the playbook says you should do.</p>
              <div className="mt-4 flex flex-wrap gap-2">{PROMPTS.map((p) => <button key={p} onClick={() => ask(p)} className="rounded-full border border-line px-3 py-1.5 text-left text-[13px] hover:bg-raised">{p}</button>)}</div>
            </div>
          ) : turns.map((t, i) => (
            <div key={i} className={t.role === 'user' ? 'ml-auto w-fit max-w-[80%] rounded-2xl bg-ink px-4 py-2.5 text-bg' : 'max-w-[92%]'}>
              <p className="whitespace-pre-wrap text-[14.5px] leading-relaxed">{t.content}</p>
              {t.model ? <p className="mt-1 text-[11.5px] text-dim">answered by {t.model}</p> : null}
            </div>
          ))}
          {busy ? <p className="text-[13.5px] text-dim">Reading treasury.eth, your memory and your wallets…</p> : null}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); void ask(q) }} className="flex gap-2 border-t border-line p-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} disabled={!loaded} placeholder={loaded ? 'Ask Agent B…' : 'Load your name first'} className="min-w-0 flex-1 rounded-xl border border-line bg-raised/50 px-3 py-2 text-[14.5px] outline-none focus:border-accent/50 disabled:opacity-60" />
          <button disabled={busy || !q.trim() || !loaded} className="rounded-xl bg-ink px-4 py-2 text-[13.5px] text-bg disabled:opacity-40">Ask</button>
        </form>
      </section>
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
