'use client'

import { usePathname } from 'next/navigation'

/**
 * Which register a route speaks in.
 *
 * Everything is monochrome — black, white, greys and opacity, a tight grotesque
 * set large, full width — the protocol pages and the product alike. Only the
 * standalone demo apps under /demo keep their own look: they stand in for
 * someone else's product reading the network, and should not look like ours.
 */
const DEMO = ['/demo']

export function ThemeScope({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const demo = DEMO.some((r) => pathname === r || pathname.startsWith(`${r}/`))
  return <div className={demo ? 'theme-demo min-h-screen' : 'theme-mono min-h-screen bg-bg text-ink'}>{children}</div>
}
