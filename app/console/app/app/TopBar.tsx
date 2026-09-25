'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AgentControls } from './AgentControls'

/**
 * The agent's status, carried in the navigation bar.
 *
 * It used to float over the canvas, where it covered the thing it was
 * describing. The nav lives in the root layout and cannot see this page's data,
 * so the bar renders into a slot the nav leaves for it — taking the place of the
 * "The protocol →" link while the workspace is open — and the slot falls back
 * to that link on every other page.
 */
export function TopBar({
  namespace,
  address,
  lastWrite,
  model,
}: {
  namespace: string
  address?: string
  lastWrite?: string
  model: string | null
}) {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useEffect(() => { setSlot(document.getElementById('kn-nav-slot')) }, [])
  if (!slot) return null

  return createPortal(
    <div className="kn-agent-bar flex items-center gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ink text-[13.5px] text-bg" aria-hidden>◈</span>
      <span className="hidden max-w-[16ch] truncate font-mono text-[13.5px] text-ink/70 2xl:inline" title={`${namespace}${address ? ` · ${address}` : ''}`}>{namespace}</span>
      <AgentControls {...(lastWrite ? { lastWrite } : {})} model={model} />
      <form action="/api/auth/signout" method="post">
        <button type="submit" className="rounded-full border border-line px-3 py-1 text-[13.5px] text-ink/70 transition hover:text-ink">
          Sign out
        </button>
      </form>
    </div>,
    slot,
  )
}
