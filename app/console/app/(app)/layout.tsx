'use client'

import { usePathname } from 'next/navigation'

/**
 * Layout for the routes inside the app group.
 *
 * Two products share this group. The protocol explorer reads like a document
 * and wants a column; the demo product's pages — sources, reviews, what was
 * left out — sit beside a workspace that runs full width, and boxing them at
 * the same measure made moving between them feel like leaving the product.
 */
const WIDE = ['/sources', '/reviews', '/why', '/contributions']

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const wide = WIDE.some((r) => pathname === r || pathname.startsWith(`${r}/`))
  return <main className={`w-full py-10 ${wide ? 'px-6' : 'px-5 sm:px-8 lg:px-10'}`}>{children}</main>
}
