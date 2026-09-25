'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { Mode } from '@/content/copy'

const ModeContext = createContext<{
  mode: Mode
  setMode: (m: Mode) => void
} | null>(null)

const KEY = 'recall:vocabulary'

/**
 * Keeps the chosen vocabulary across routes.
 *
 * Persisted to localStorage so a reader who switched to ENS terms on one page
 * does not land back in plain English on the next. Every access is wrapped:
 * storage throws in private windows and with site data blocked, and the page
 * has to render correctly when it is unavailable — so the default is simply the
 * plain reading.
 */
export function ModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<Mode>('plain')

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(KEY)
      if (stored === 'ens' || stored === 'plain') setModeState(stored)
    } catch {
      // Unavailable. The default stands.
    }
  }, [])

  const setMode = useCallback((next: Mode) => {
    setModeState(next)
    try {
      window.localStorage.setItem(KEY, next)
    } catch {
      // Unavailable. The choice still applies for this page view.
    }
  }, [])

  return <ModeContext.Provider value={{ mode, setMode }}>{children}</ModeContext.Provider>
}

export function useMode() {
  const ctx = useContext(ModeContext)
  if (!ctx) throw new Error('useMode must be used inside ModeProvider')
  return ctx
}
