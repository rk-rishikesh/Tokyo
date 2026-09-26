import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Footer } from '@/components/Guide'
import { GUIDES, ROLES, type RoleId } from '@/components/RoleGuides'
import { Arrow } from '@/components/Arrow'

export function generateStaticParams() { return ROLES.map((r) => ({ role: r.id })) }
export async function generateMetadata({ params }: { params: Promise<{ role: string }> }) {
  const { role } = await params
  const r = ROLES.find((x) => x.id === role)
  return { title: r ? `${r.title} — roles & guides` : 'Roles & guides' }
}

export default async function RolePage({ params }: { params: Promise<{ role: string }> }) {
  const { role } = await params
  const meta = ROLES.find((r) => r.id === role)
  if (!meta) notFound()
  const Guide = GUIDES[meta.id as RoleId]
  const idx = ROLES.findIndex((r) => r.id === meta.id)
  const prev = ROLES[(idx + ROLES.length - 1) % ROLES.length]!
  const next = ROLES[(idx + 1) % ROLES.length]!
  return (
    <>
      <section className="w-full px-5 pb-4 pt-10 sm:px-8 lg:px-10">
        <p className="text-[13px] text-dim"><Link href="/roles" className="hover:text-ink hover:underline underline-offset-4">Roles &amp; guides</Link> <span aria-hidden>/</span> {meta.who}</p>
        <div className="mt-6 grid gap-6 lg:grid-cols-2 lg:items-end">
          <div>
            <h1 className="font-display text-[clamp(2.4rem,4.6vw,3.8rem)] font-normal leading-[1.02] tracking-[-0.02em]">{meta.title}</h1>
            <p className="mt-3 max-w-xl text-[16px] leading-relaxed text-dim">{meta.line}</p>
          </div>
          <nav aria-label="Roles" className="flex w-fit flex-wrap gap-1 rounded-full border border-line bg-surface p-1 lg:justify-self-end">
            {ROLES.map((r) => (
              <Link key={r.id} href={`/roles/${r.id}`} aria-current={r.id === meta.id ? 'page' : undefined}
                className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-[14px] capitalize transition-colors ${r.id === meta.id ? 'bg-ink text-bg' : 'text-dim hover:text-ink'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${r.id === meta.id ? 'bg-bg' : r.dot}`} aria-hidden />{r.id}
              </Link>
            ))}
          </nav>
        </div>
      </section>
      <main className="w-full px-5 sm:px-8 lg:px-10">
        <Guide />
        <section className="flex justify-between border-t border-line py-10 text-[15px]">
          <Link href={`/roles/${prev.id}`} className="text-ink underline underline-offset-4 hover:opacity-70">← {prev.id}</Link>
          <Link href={`/roles/${next.id}`} className="text-ink underline underline-offset-4 hover:opacity-70">{next.id} <Arrow /></Link>
        </section>
        <Footer />
      </main>
    </>
  )
}
