'use client'

/**
 * The portability test, run in the owner's own browser.
 *
 * Sign → derive the owner key → fetch public bytes → decrypt here. The server
 * never sees the key, and the code doing the decrypting shares nothing with the
 * code that wrote the memory.
 */
import { useState } from 'react'
import { deriveOwnerKey, recoverNamespace, type Recovered } from '@/lib/recover'

export function Recover({ owner, namespaces }: { owner: string; namespaces: string[] }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [out, setOut] = useState<Recovered[] | null>(null)

  const run = async () => {
    setError(null)
    setOut(null)
    try {
      setBusy('Sign in your wallet…')
      const key = await deriveOwnerKey(owner)
      setBusy('Fetching ciphertext and decrypting in this tab…')
      setOut(await Promise.all(namespaces.map((ns) => recoverNamespace(ns, key))))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="rounded-3xl border border-line bg-surface p-6">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={run} disabled={!!busy || !namespaces.length} className="rounded-full bg-ink px-5 py-2.5 text-[15px] text-bg disabled:opacity-50">
          {busy ?? 'Read my memory with only my wallet'}
        </button>
        <p className="text-[14px] text-dim">Your key is derived and used in this tab. The server only serves bytes.</p>
      </div>
      {error ? <p className="mt-3 text-[14.5px] text-removed">{error}</p> : null}
      {out ? (
        <div className="mt-5 space-y-3">
          {out.map((r) => (
            <div key={r.namespace} className="rounded-2xl border border-line p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[14.5px]">{r.namespace}</span>
                {r.ok ? (
                  <span className="rounded-full bg-added-bg px-2 py-0.5 text-[13px] text-added">decrypted in your browser · {r.source === 'chain' ? 'read from your ENS name' : 'staged, not on chain yet'} · v{r.version} · {r.bytesFetched.toLocaleString()} bytes fetched</span>
                ) : (
                  <span className="rounded-full bg-warn-bg px-2 py-0.5 text-[13px] text-warn">{r.reason}</span>
                )}
              </div>
              {r.ok ? (
                <ul className="mt-2 space-y-1 text-[13.5px]">
                  {r.claims.map((c) => (
                    <li key={c.id}>
                      {c.claim} <span className="font-mono text-[12.5px] text-dim">— {c.sources.map((s) => s.name ?? s.type).join(', ')}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
