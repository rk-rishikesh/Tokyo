'use client'

/**
 * Make the memory recoverable from the wallet alone.
 *
 * One signature. The page derives a key from it, sends only the public half,
 * and every namespace gets a sealed copy of its key for that public key. After
 * that, deleting this app loses nothing the owner cannot get back by signing
 * the same message again.
 */
import { useState } from 'react'
import { deriveOwnerKey } from '@/lib/recover'

export function OwnerKeySetup({ owner, has }: { owner: string; has: boolean }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setError(null)
    try {
      setBusy('Sign in your wallet — this costs nothing')
      const key = await deriveOwnerKey(owner)
      setBusy('Sealing each namespace to your key…')
      const r = await fetch('/api/owner-key', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pubkey: key.pubkey, address: key.address }) })
      const out = (await r.json()) as { error?: string }
      if (!r.ok) throw new Error(out.error ?? 'could not save')
      window.location.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(null)
    }
  }

  return (
    <div className={`rounded-3xl border p-5 ${has ? 'border-line' : 'border-accent/40 bg-accent-soft'}`}>
      <p className="text-[14px] font-medium">{has ? '✓ Recoverable with your wallet' : 'Make your memory recoverable with your wallet'}</p>
      <p className="mt-1 max-w-xl text-[14.5px] leading-relaxed text-dim">
        {has
          ? 'Every namespace carries a key sealed to one derived from your wallet signature. Sign the same message anywhere and you can read all of it — without this app.'
          : 'Right now the keys to your namespaces live in this app. One signature derives a key only your wallet can re-create; each namespace gets sealed to it, so the app disappearing costs you nothing.'}
      </p>
      <button onClick={run} disabled={!!busy} className={`mt-3 rounded-full px-4 py-2 text-[15px] ${has ? 'border border-line' : 'bg-ink text-bg'}`}>
        {busy ?? (has ? 'Re-seal all namespaces' : 'Sign once to protect it')}
      </button>
      {error ? <p className="mt-2 text-[13.5px] text-removed">{error}</p> : null}
    </div>
  )
}
