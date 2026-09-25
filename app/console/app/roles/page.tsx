import Link from 'next/link'
import { Footer, Hero } from '@/components/Guide'
import { EdgesSection, InstallSection, ROLES } from '@/components/RoleGuides'
import { Arrow } from '@/components/Arrow'

export const metadata = { title: 'Roles & guides' }

export default function Roles() {
  return (
    <>
      <Hero kicker="Roles & guides" title="Four roles. One namespace." sub="Owner, contributor, reviewer, consumer — each with how it works and how to use it. A single person often holds several. Everything here runs today with the `knowledge` CLI, the MCP server and this explorer." />
      <main className="w-full px-5 sm:px-8 lg:px-10">
        <section className="py-10">
          <div className="grid gap-4 md:grid-cols-2">
            {ROLES.map((r) => (
              <Link key={r.id} href={`/roles/${r.id}`} className={`group rounded-2xl border bg-surface p-6 transition-colors hover:bg-raised/60 ${r.tone}`}>
                <div className="flex items-center gap-2"><span className={`h-1.5 w-1.5 rounded-full ${r.dot}`} /><span className={`text-[12.5px] font-medium uppercase tracking-wider ${r.text}`}>{r.who}</span></div>
                <p className="mt-3 text-[14.5px] leading-relaxed text-ink/85">{r.line}</p>
                <span className={`mt-4 block text-[15px] ${r.text} transition-transform group-hover:translate-x-0.5`}>how it works · how to use <Arrow /></span>
              </Link>
            ))}
          </div>
        </section>
        <InstallSection />
        <EdgesSection />
        <Footer />
      </main>
    </>
  )
}
