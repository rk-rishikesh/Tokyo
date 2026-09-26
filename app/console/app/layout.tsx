import type { Metadata } from 'next'
import { Geist_Mono, Instrument_Serif, Inter_Tight } from 'next/font/google'
import './globals.css'
import { Nav } from '@/components/Nav'
import { ModeProvider } from '@/components/ModeContext'
import { ThemeScope } from '@/components/ThemeScope'

/**
 * Three faces, each with one job, on every page.
 *
 * Instrument Serif for headings: every page title and section heading, the
 * hero included, and display numbers. Prose set large under a heading (a
 * lede) is read, so it is the sans. The product argues that a claim is an authored, dated,
 * attributed thing rather than a row in a vendor's store, and the serif is
 * where it does the arguing. Inter Tight for everything read: body, labels,
 * controls. Geist Mono for what is identified rather than read: names,
 * addresses, versions, ids, amounts — loaded rather than left to the system,
 * so an address looks the same on every machine.
 *
 * Headings used to switch face by route (serif on the demo, grotesque on the
 * protocol pages), and body text used two sans faces; moving between pages
 * read as moving between products.
 *
 * Self-hosted by next/font, so there is no request to Google at runtime and no
 * layout shift while a face loads.
 */
const serif = Instrument_Serif({ subsets: ['latin'], weight: '400', variable: '--font-serif', display: 'swap' })
const sans = Inter_Tight({ subsets: ['latin'], weight: ['300', '400', '500', '600', '700'], variable: '--font-sans', display: 'swap' })
const mono = Geist_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-mono', display: 'swap' })

export const metadata: Metadata = {
  title: 'Knowledge Network — shared, versioned knowledge for AI agents',
  description: 'Give knowledge an ENS identity. Give it Git-like history. Store it immutably on IPFS. Let people and agents build it together, review it, and let other agents use it.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen antialiased"><ModeProvider><ThemeScope><Nav />{children}</ThemeScope></ModeProvider></body>
    </html>
  )
}
