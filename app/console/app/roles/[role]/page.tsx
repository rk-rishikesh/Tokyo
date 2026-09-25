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
      <section className="w-full px-5 sm:px-8 lg:px-10 pt-10">
        <p className="text-[13.5px] text-dim"><Link href="/roles" className="text-ink underline underline-offset-4 hover:opacity-70">roles & guides</Link> / {meta.id}</p>
        <div className="mt-2 flex items-center gap-2"><span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} /><span className={`text-[12.5px] font-medium uppercase tracking-wider ${meta.text}`}>{meta.who}</span></div>
        <h1 className="mt-2 text-3xl font-display font-normal tracking-tight">{meta.title}</h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-dim">{meta.line}</p>
        <nav className="mt-5 flex flex-wrap gap-2 text-[15px]">
          {ROLES.map((r) => <Link key={r.id} href={`/roles/${r.id}`} className={`rounded-full border px-3 py-1 ${r.id === meta.id ? 'border-ink bg-ink text-bg' : 'border-line text-dim hover:text-ink'}`}>{r.id}</Link>)}
        </nav>
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
