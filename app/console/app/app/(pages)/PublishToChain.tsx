'use client'

/**
 * Sign & publish: take what is staged and put it on the owner's name.
 *
 * Asks the server for the next transaction, has the wallet send it, waits, and
 * asks again — until the server says the chain is current. The first time this
 * includes a one-time setup (a shared resolver, a registry, one registration per
 * namespace); after that a publish of every namespace is one transaction.
 */
import { useState } from 'react'
import { injected } from '@/lib/recover'
import { Arrow } from '@/components/Arrow'

type Step = { kind: string; label: string; to: string; data: string; names?: string[] }
type Plan = { step: Step | null; setupRemaining: number; namespaces: { name: string; current: boolean }[] }

const SEPOLIA = '0xaa36a7'

type Call = { to: string; data: string; label: string }
type Eth = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> }

/**
 * Send everything as one confirmation, if the wallet can (EIP-5792).
 *
 * Returns 'done' when the batch landed, 'unsupported' when the wallet cannot
 * batch — the caller then falls back to one transaction at a time — and
 * throws when the person declined or the batch reverted. A batch is atomic:
 * if any call fails, none of them happened.
 */
async function sendBatch(eth: Eth, address: string, onStatus: (s: string) => void, onCalls: (labels: string[]) => void): Promise<'done' | 'unsupported'> {
  const r = await fetch('/api/chain/batch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address }) })
  const batch = (await r.json()) as { calls?: Call[]; error?: string }
  if (!r.ok) throw new Error(batch.error ?? 'could not prepare the batch')
  const calls = batch.calls ?? []
  if (!calls.length) return 'done'
  onCalls(calls.map((c) => c.label))

  onStatus(calls.length === 1 ? `${calls[0]!.label} — confirm in your wallet` : `${calls.length} steps in one confirmation — check your wallet`)
  let id: string
  try {
    const res = (await eth.request({
      method: 'wallet_sendCalls',
      params: [{ version: '2.0.0', chainId: SEPOLIA, from: address, atomicRequired: true, calls: calls.map((c) => ({ to: c.to, data: c.data, value: '0x0' })) }],
    })) as string | { id: string }
    id = typeof res === 'string' ? res : res.id
  } catch (e) {
    const err = e as { code?: number; message?: string }
    if (err.code === 4001 || /reject|denied/i.test(err.message ?? '')) throw e
    // Method missing, atomic batching unavailable, or an older wallet: go one by one.
    return 'unsupported'
  }

  onStatus('Waiting for the batch to land…')
  for (let i = 0; i < 120; i++) {
    await new Promise((z) => setTimeout(z, 2000))
    const st = (await eth.request({ method: 'wallet_getCallsStatus', params: [id] }).catch(() => null)) as
      | { status: number | string; receipts?: { status: string }[] } | null
    if (!st) continue
    const code = typeof st.status === 'number' ? st.status : st.status === 'CONFIRMED' ? 200 : st.status === 'PENDING' ? 100 : 400
    if (code === 100) continue
    if (code === 200 && (st.receipts ?? []).every((x) => x.status === '0x1' || x.status === 'success')) return 'done'
    throw new Error('The batch reverted — nothing in it happened. Try again, or it will go one step at a time.')
  }
  throw new Error('The batch has not landed after four minutes. It may still arrive; check again shortly.')
}

export function PublishToChain({ pending, setup, urgent, compact, summary }: { pending: number; setup: number; urgent?: string; compact?: boolean; summary?: string }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [progress, setProgress] = useState<{ n: number; of: number } | null>(null)
  const [stopped, setStopped] = useState(false)

  const run = async () => {
    const eth = injected() as Eth | null
    if (!eth) { setError('No wallet in this browser.'); return }
    setError(null); setLog([]); setDone(false); setStopped(false)
    try {
      const [address] = (await eth.request({ method: 'eth_requestAccounts' })) as string[]
      if ((await eth.request({ method: 'eth_chainId' })) !== SEPOLIA) {
        await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: SEPOLIA }] })
      }
      // One confirmation for everything, when the wallet can batch.
      const batched = await sendBatch(eth, address!, setBusy, (labels) => setLog(labels.map((l) => `· ${l}`)))
      if (batched === 'done') {
        setLog((l) => l.map((x) => x.replace(/^· /, '✓ ')))
        setBusy('Checking the chain…')
        await new Promise((z) => setTimeout(z, 2500))
      } else {
        setLog([])
      }

      // Step by step: the fallback, and a final check that nothing is left.
      let stage = batched !== 'done'
      let total = 0
      let sent = 0
      const next = async (): Promise<Plan> => {
        // One retry: a check right after a block lands can read stale state.
        for (let attempt = 0; ; attempt++) {
          const r = await fetch('/api/chain/next', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address, stage }) })
          const plan = (await r.json()) as Plan & { error?: string }
          if (r.ok) return plan
          if (attempt >= 1) throw new Error(plan.error ?? 'could not plan')
          await new Promise((z) => setTimeout(z, 4000))
        }
      }
      for (let i = 0; i < 20; i++) {
        setBusy(stage ? 'Uploading encrypted versions to IPFS…' : 'Checking the chain…')
        const plan = await next()
        stage = false
        if (!plan.step) { setDone(true); setProgress(null); break }
        // Everything still ahead: the one-time setup plus the publish itself.
        if (!total) total = plan.setupRemaining + 1
        const n = Math.min(total, sent + 1)
        setProgress({ n, of: Math.max(total, n) })
        setBusy(`${plan.step.label} — confirm in your wallet`)
        const hash = (await eth.request({ method: 'eth_sendTransaction', params: [{ from: address, to: plan.step.to, data: plan.step.data }] })) as string
        setBusy(`${plan.step.label} — waiting for the block`)
        const w = await fetch('/api/chain/wait', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hash }) })
        const res = (await w.json()) as { ok?: boolean; error?: string }
        if (!w.ok || !res.ok) throw new Error(res.error ?? `${plan.step.label} reverted`)
        setLog((l) => [...l, `✓ ${plan.step!.label}`])
        sent++
        // Let the RPC catch up before reading the state this step changed.
        await new Promise((z) => setTimeout(z, 2500))
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      setError(/user rejected|denied/i.test(m) ? 'You declined in the wallet. Nothing after the last ✓ was sent.' : m)
      setStopped(true)
    } finally {
      setBusy(null)
    }
  }

  const title = done ? 'On chain' : urgent ? 'Revoked here, still readable on chain' : pending ? (summary ?? `${pending} namespace${pending === 1 ? '' : 's'} waiting to publish`) : 'Everything is on chain'
  return (
    <div className={`rounded-[28px] border ${urgent ? 'border-ink' : 'border-line'} bg-surface ${compact ? 'p-5' : 'p-7'}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl">
          <p className="text-[12.5px] uppercase tracking-[0.14em] text-dim">publish to your name</p>
          <p className="mt-1.5 text-[19px] leading-snug tracking-[-0.01em]">{title}</p>
          <p className="mt-1.5 text-[14.5px] leading-relaxed text-dim">
            {urgent
              ? `${urgent} Until you sign, the chain still carries their sealed key.`
              : done
                ? 'The chain now says exactly what is staged here. Any agent you granted reads it from ENS and IPFS.'
                : setup
                  ? `First time sets up a home on chain for your namespaces (${setup} step${setup === 1 ? '' : 's'}) and publishes them — one confirmation if your wallet batches, otherwise one per step. After that, every publish is a single signature.`
                  : 'One signature publishes every namespace — the version pointer and who may read it.'}
          </p>
        </div>
        {(done || (!pending && !urgent && !setup)) && !busy ? (
          // Nothing to publish: a mark that says so, not a button that does nothing.
          <span className="inline-flex items-center gap-2 text-[14.5px] text-ink/70" role="status">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-bg" aria-hidden>
              <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 8.5l3 3 6-7" /></svg>
            </span>
            Up to date
          </span>
        ) : (
          <button
            onClick={run}
            disabled={!!busy}
            className="group inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-[14.5px] text-bg transition-opacity disabled:opacity-40"
          >
            {busy ? 'Working…' : stopped ? 'Continue' : 'Sign & publish'} <Arrow />
          </button>
        )}
      </div>
      {progress && busy ? (
        <div className="mt-5">
          <div className="flex items-baseline justify-between text-[13.5px]">
            <span>Step {progress.n} of {progress.of}</span>
            <span className="text-dim">{busy}</span>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-raised">
            <div className="h-full rounded-full bg-ink transition-all" style={{ width: `${((progress.n - 1) / progress.of) * 100}%` }} />
          </div>
        </div>
      ) : busy ? <p className="mt-4 text-[14px] text-dim">{busy}</p> : null}
      {stopped && !busy ? <p className="mt-3 text-[14px] text-dim">Stopped partway. What landed is on chain; Continue picks up from the next step.</p> : null}
      {log.length ? <ul className="mt-3 space-y-1 font-mono text-[13px] text-dim">{log.map((l) => <li key={l}>{l}</li>)}</ul> : null}
      {error ? <p className="mt-3 text-[14px] text-removed">{error}</p> : null}
    </div>
  )
}
