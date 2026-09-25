'use client'

/**
 * The consent screen — the moment the argument lands. It asks for read access
 * and says, in the same breath, where what it learns will live: a namespace
 * under your name, not the agent's database.
 */
import { Monogram } from '@/components/Monogram'
import { useState, useTransition } from 'react'
import { providerLabel, type WorkspaceDef } from '@knowledge01/connect/workspaces'
import { connectWorkspace, disconnectWorkspace } from './actions'

const providerName = (p?: string) => (p ? providerLabel(p).name : 'the provider')

/**
 * `needsAuth` is true when this is an OAuth source whose provider the person has
 * not signed into yet. Allowing then means leaving for the provider's own
 * consent screen, so the button has to say so — "Allow access" on a dialog that
 * actually redirects to GitHub is the dark pattern this product argues against.
 */
export function ConnectButton({ ws, connected, owner, needsAuth }: { ws: WorkspaceDef; connected: boolean; owner: string; needsAuth?: boolean }) {
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const oauth = ws.access === 'oauth'

  if (connected) {
    return (
      <button onClick={() => start(() => { void disconnectWorkspace(ws.id) })} disabled={pending}
        className="rounded-lg border border-line px-3 py-1.5 text-[13.5px] text-dim transition-colors hover:border-removed hover:text-removed disabled:opacity-50">
        {pending ? 'revoking…' : 'Revoke'}
      </button>
    )
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-lg bg-ink px-3 py-1.5 text-[13.5px] font-medium text-bg transition-opacity hover:opacity-90">
        {needsAuth ? `Sign in with ${providerName(ws.provider)}` : 'Connect'}
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-lg rounded-2xl border border-line bg-surface p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <Monogram name={ws.name} size="lg" />
              <div>
                <p className="text-[15px] font-semibold">Connect {ws.name}</p>
                <p className="break-all text-[12.5px] text-dim">{ws.account}</p>
              </div>
            </div>

            <p className="mt-5 text-[14.5px] font-medium">This agent is asking to:</p>
            <ul className="mt-2 space-y-2">
              {ws.scopes.map((s) => (
                <li key={s.id} className="flex gap-2 text-[14.5px]">
                  <span className="mt-[3px] text-accent" aria-hidden>✓</span>
                  <span><span className="font-medium">{s.label}</span><span className="block text-[13.5px] leading-snug text-dim">{s.detail}</span></span>
                </li>
              ))}
            </ul>

            <p className="mt-4 text-[14.5px] font-medium">It will never:</p>
            <ul className="mt-2 space-y-1">
              {ws.never.map((n) => <li key={n} className="flex gap-2 text-[14.5px] text-dim"><span className="text-removed" aria-hidden>✗</span>{n}</li>)}
            </ul>

            <div className="mt-5 rounded-xl border border-accent/40 bg-accent-soft p-3">
              <p className="text-[14px] leading-relaxed">
                What it learns is written to <span className="font-mono font-medium">&lt;topic&gt;.{owner}</span> — namespaces <strong>you</strong> own.
                Revoke any time: the agent stops reading, and everything it wrote stays yours.
              </p>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="rounded-lg border border-line px-4 py-2 text-[15px]">Cancel</button>
              {needsAuth ? (
                <a href={`/api/auth/${ws.provider}/start`}
                  className="rounded-lg bg-ink px-4 py-2 text-[15px] font-medium text-bg">
                  Continue to {providerName(ws.provider)}
                </a>
              ) : (
                <button
                  onClick={() => start(() => { void connectWorkspace(ws.id).then(() => setOpen(false)) })}
                  disabled={pending}
                  className="rounded-lg bg-ink px-4 py-2 text-[15px] font-medium text-bg disabled:opacity-50">
                  {pending ? 'connecting…' : 'Allow access'}
                </button>
              )}
            </div>
            <p className="mt-3 text-[12.5px] leading-snug text-dim">
              {needsAuth
                ? `You will sign in at ${providerName(ws.provider)} and approve the access above. The token is held by this server, encrypted, and never reaches your browser.`
                : oauth
                  ? `Your ${providerName(ws.provider)} account is already connected. This starts reading it.`
                  : 'This reads a file on your machine. Nothing is sent anywhere, and no account is contacted.'}
            </p>
          </div>
        </div>
      ) : null}
    </>
  )
}
