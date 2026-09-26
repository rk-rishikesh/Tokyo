import Link from 'next/link'
import { Callout, Footer, Hero, Section } from '@/components/Guide'

export const metadata = { title: 'vs. agent-memory platforms' }

const CLAIMS: [string, string, string][] = [
  ['Portable', 'On a memory platform, what it learned lives in that vendor’s database, under their user id. Leave, and it stays behind.', 'With K01 it lives at an ENS name you own, as objects on IPFS. Change assistants and the next one reads the same memory.'],
  ['Versioned', 'A newer extraction quietly replaces an older one. There is no history to look at and nothing to undo.', 'With K01 every change is a commit. Earlier versions stay readable, and a wrong claim is reverted, not erased.'],
  ['Yours to share', 'Another app can only get your memory as a copy, through an export and a re-import.', 'With K01 a second app reads the same name and the same version. For private memory, you grant it a key — and can take it back.'],
]

const ROWS: [string, string, string][] = [
  ['Who it is for', 'Developers adding memory to their app.', 'People who own their memory, the agents that read and write it, and developers building on it.'],
  ['Who the memory serves', 'The app. You are the subject of the record, not its owner.', 'You. Apps read and propose; the name is registered to your wallet.'],
  ['Can you see what is held', 'Only if the app builds a way to show you.', 'Yes — every claim, its source and its history, at your name.'],
  ['How fast it saves', 'Milliseconds.', 'Milliseconds on your machine; published to your name on a schedule you set.'],
  ['Where it lives', 'The vendor’s database.', 'An ENS name you own, with its versions on IPFS.'],
  ['What is stored', 'Snippets of text with tags and a date.', 'Claims, each with its sources, who added it, who checked it, and a version.'],
  ['Who else can read it', 'The app, through their API.', 'Any agent you allow — anyone for public memory, key holders for private.'],
  ['Can you take it with you', 'Export it, then import it somewhere else as new text.', 'It is already yours. Same name, same history, next assistant.'],
  ['When facts conflict', 'The newest one wins, silently.', 'Flagged. On your own memory the newest wins and it is noted; on shared memory a reviewer decides.'],
  ['Two sources agree', 'Two entries, or a merge you can’t inspect.', 'One claim, both sources listed, and higher confidence.'],
  ['Review', 'None.', 'Your choice per namespace: instant for personal memory, reviewed for shared knowledge.'],
  ['Shared knowledge', 'Not covered.', 'The same building block: cancer-research.eth or conventions.acme.eth, owned by others, read by your agent.'],
  ['Search quality', 'Strong: embeddings, graph memory, tuning.', 'Simpler keyword search by topic and subject; a vector index can sit underneath.'],
  ['Setup', 'An API key.', 'An ENS name and one connected app. A few more steps, because you end up owning it.'],
]

export default function VersusMemory() {
  return (
    <>
      <Hero kicker="K01 compared · agent memory" title="Memory that stays with you, not with the app." sub="Memory platforms such as Mem0 and Supermemory give an app memory that outlives the session and the restart — and they do it well. K01 answers a different question: who the memory belongs to, and whether the next agent you use can read it." actions={<><Link href="/demo/portability" className="rounded-full bg-ink px-5 py-3 text-[14px] font-medium text-bg transition-opacity hover:opacity-90">See it: leave a vendor, keep what it learned</Link></>} />
      <main className="w-full px-5 sm:px-8 lg:px-10">
        <Section title="What “persistent” leaves out" intro="Memory platforms do keep what they learn across sessions and restarts — that part works. What they don’t give you is memory that belongs to you.">
          <div className="grid gap-4 md:grid-cols-3">
            {CLAIMS.map(([t, what, why]) => <div key={t} className="rounded-2xl border border-line bg-surface p-5"><p className="text-[15px] font-semibold">{t}</p><p className="mt-2 text-[14.5px] leading-relaxed text-ink/85">{what}</p><p className="mt-2 text-[14.5px] leading-relaxed text-dim">{why}</p></div>)}
          </div>
          <div className="mt-6"><Callout title="In one line"><p>Their memory is <strong>persistent for the application.</strong> K01’s is <strong>persistent for you</strong>: it exists on its own, under your name, and applications read it.</p></Callout></div>
        </Section>

        <Section title="Side by side" intro="Two different approaches. Where memory platforms are stronger, the table says so.">
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full text-left text-[14.5px]">
              <thead className="text-[13.5px] text-dim"><tr className="border-b border-line"><th className="px-4 py-2 font-medium">Question</th><th className="px-4 py-2 font-medium">Memory platforms<span className="block font-normal opacity-70">Mem0, Supermemory</span></th><th className="px-4 py-2 font-medium text-accent">K01</th></tr></thead>
              <tbody>{ROWS.map(([q, a, c]) => <tr key={q} className="border-b border-line last:border-0 align-top"><td className="px-4 py-3 font-medium">{q}</td><td className="px-4 py-3 text-dim">{a}</td><td className="px-4 py-3 text-ink/85">{c}</td></tr>)}</tbody>
            </table>
          </div>
        </Section>

        <Footer />
      </main>
    </>
  )
}
