import type { Metadata } from 'next'
import { Instrument_Serif, Inter, Inter_Tight } from 'next/font/google'
import './globals.css'
import { Nav } from '@/components/Nav'
import { ModeProvider } from '@/components/ModeContext'
import { ThemeScope } from '@/components/ThemeScope'

/**
 * Two faces, doing two jobs.
 *
 * A serif for display and a grotesque for everything else. The product argues
 * that a claim is an authored, dated, attributed thing rather than a row in a
 * vendor's store — and a page set entirely in system sans reads like a
 * dashboard, which is the opposite of that. The serif is reserved for headings,
 * where it does the arguing; body text stays in the sans because provenance is
 * read, not admired.
 *
 * Self-hosted by next/font, so there is no request to Google at runtime and no
 * layout shift while a face loads.
 */
const serif = Instrument_Serif({ subsets: ['latin'], weight: '400', variable: '--font-serif', display: 'swap' })
// The protocol pages speak in a tight grotesque, set large; the serif stays for
// the hero and the demo product, which argue in a different register.
const grotesk = Inter_Tight({ subsets: ['latin'], weight: ['300', '400', '500'], variable: '--font-grotesk', display: 'swap' })
const sans = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' })

export const metadata: Metadata = {
  title: 'Knowledge Network — shared, versioned knowledge for AI agents',
  description: 'Give knowledge an ENS identity. Give it Git-like history. Store it immutably on IPFS. Let people and agents build it together, review it, and let other agents use it.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${grotesk.variable} ${sans.variable}`}>
      <body className="min-h-screen antialiased"><ModeProvider><ThemeScope><Nav />{children}</ThemeScope></ModeProvider></body>
    </html>
  )
}
