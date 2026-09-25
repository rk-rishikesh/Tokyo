import Link from 'next/link'
import { Callout, Footer, Hero, Section } from '@/components/Guide'

export const metadata = { title: 'vs. agent-memory platforms' }

const CLAIMS: [string, string, string][] = [
  ['Not portable', 'It persists inside one vendor’s database, keyed to their user id.', 'Leave the vendor and it is gone. That is lock-in, not impermanence. Here the namespace is an ENS name your key controls; the objects are on IPFS by content hash.'],
  ['Not immutable', 'A later extraction silently overwrites an earlier one.', 'No version, no diff, no undo — the old value is actually destroyed. Here every change is a commit; `vN` is reachable forever; a wrong claim is reverted, not erased.'],
  ['Not sovereign', 'You hold no key and cannot grant another app read access without copying.', 'Sharing exists as copying, not as reading. Here a second application resolves the same name and reads the same version; a private namespace is shared by handing over a key.'],
]

const ROWS: [string, string, string, string][] = [
  ['Who it is for', 'Developers adding memory to an application.', 'A person, through chat or voice. No API to build against.', 'Both — and the agents they use, whichever those are.'],
  ['Who is the customer', 'The application. A developer integrates the SDK; the person is the subject of the record rather than a party to it. Supermemory ships seven OAuth connectors the developer embeds and the end user authorises; Mem0 ships none — the developer supplies the data.', 'The person, directly.', 'The person. Applications read and propose; the namespace is registered to a wallet they hold.'],
  ['Where the person signs in', 'Into the developer’s product, if it offers one. There is no account with the memory platform itself, so there is nowhere to see what is held or take it elsewhere.', 'Into the assistant. Invite-only, and the connector list is not published.', 'Nowhere. They prove an ENS name they already own, and the namespace is theirs before any app is connected.'],
  ['Write latency', 'Milliseconds, in the vendor’s API.', 'Invisible; the assistant writes as it works.', 'Milliseconds to a local commit. Publishing is a separate, batched step — one transaction on a cadence the namespace chooses.'],
  ['Where it lives', 'The vendor’s store, under their user id.', 'Their cloud computer, under your account with them.', 'A name you own; content-addressed objects anyone can verify.'],
  ['What is stored', 'Extracted memories: text, tags, a timestamp.', 'Whatever the assistant infers, in a form you do not see.', 'Claims: subject, statement, topic, confidence, sources, contributor, reviewers, version.'],
  ['Who else can read it', 'Your app, through their API.', 'Their assistant. That is the product.', 'Any agent or app that resolves the name — with the key, for private namespaces.'],
  ['Can you take it with you', 'Export, then re-ingest somewhere else as fresh text.', 'Not a stated feature.', 'It was never theirs to hold. Same name, same versions, next assistant.'],
  ['Conflicting facts', 'Latest extraction wins, silently.', 'Resolved silently, by them.', 'Detected. Personal namespaces resolve by policy (latest wins) and record the finding; shared ones ask a reviewer. A changed fact is marked `supersedes`; a disagreement is a contradiction.'],
  ['Two sources say the same thing', 'Two memories, or a dedupe you cannot inspect.', 'One memory, presumably.', 'One claim with two sources and higher confidence — 0.8 + 0.8 → 0.96, stated as a function.'],
  ['Review', 'None.', 'None, by design — it is your assistant.', 'A policy per namespace: gates public and organisational knowledge, auto-lands personal knowledge while still recording findings.'],
  ['Shared knowledge', 'Out of scope.', 'Out of scope.', 'The same primitive: cancer-research.eth, treasury.kestrel.eth, conventions.acme.eth — owned by others, read by your agent.'],
  ['Retrieval quality', 'Strong: embeddings, graph memory, relevance tuning.', 'Strong, and proactive — it acts before you ask.', 'Keyword ranking scoped by topic and subject. Deliberately thin; a vector index can sit underneath. We do not compete here.'],
  ['Setup', 'An API key.', 'An invite.', 'A local repository, optionally an ENS registration for publishing. More steps; the steps are the point.'],
]

export default function VersusMemory() {
  return (
    <>
      <Hero kicker="Comparison · agent-memory platforms" title="Persistent to whom, and for how many versions?" sub="Agent-memory platforms such as Mem0 and Supermemory are telling the truth about what they claim: memory that outlives the session, the context window, the restart. Against a stateless model that is real and it works. The question they cannot answer is a different one." actions={<><Link href="/demo/portability" className="rounded-full bg-ink px-5 py-3 text-[14px] font-medium text-bg transition-opacity hover:opacity-90">see it: leave a vendor, keep what it learned</Link><Link href="/compare" className="rounded-full border border-line px-5 py-3 text-[14px] hover:bg-raised">vs. GitHub</Link></>} />
      <main className="w-full px-5 sm:px-8 lg:px-10">
        <Section title="Say it precisely" intro="Say “it is not persistent” and someone will demo it surviving a restart and you have lost the room. Three different things are missing, and only the first is what people usually mean by persistent.">
          <div className="grid gap-4 md:grid-cols-3">
            {CLAIMS.map(([t, what, why]) => <div key={t} className="rounded-2xl border border-line bg-surface p-5"><p className="text-[15px] font-semibold">{t}</p><p className="mt-2 text-[14.5px] leading-relaxed text-ink/85">{what}</p><p className="mt-2 text-[14.5px] leading-relaxed text-dim">{why}</p></div>)}
          </div>
          <div className="mt-6"><Callout title="The honest framing"><p>Not “they lie about persistence.” It is <strong>persistent for the application, not for you.</strong> Their memory exists inside the application. Here, knowledge exists independently and applications consume it.</p></Callout></div>
        </Section>

        <Section title="Memory or knowledge? One test" intro="A sentence decides which side something falls on, and therefore whether it needs sources, a reviewer and a version.">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-line bg-surface p-5"><p className="text-[12.5px] font-medium uppercase tracking-wider text-dim">Memory</p><p className="mt-2 text-[15px] font-medium">“Would a second party want to know where this came from?” — No.</p><p className="mt-2 text-[14.5px] leading-relaxed text-dim">A byproduct of interaction. One principal. Can only go stale. “User seemed frustrated on Tuesday.” Nobody else will ever ask for its source.</p></div>
            <div className="rounded-2xl border border-accent/45 bg-surface p-5"><p className="text-[12.5px] font-medium uppercase tracking-wider text-accent">Knowledge</p><p className="mt-2 text-[15px] font-medium">“Would a second party want to know where this came from?” — Yes.</p><p className="mt-2 text-[14.5px] leading-relaxed text-dim">Authored. Has a truth condition. Read by people who were not there when it was written. “We use pnpm, not npm.” “No single DeFi protocol may hold more than 15% of treasury assets.” “Prefers vegetarian food” — the moment a second app acts on it.</p></div>
          </div>
          <p className="mt-4 text-[14.5px] leading-relaxed text-dim">Personal memory is still a use case here — a private namespace with `approvals: 0`, so writes land instantly and review never gets in the way. The difference is that the same object model carries it, so the day a second agent needs it, it already has a name, a version and a source.</p>
        </Section>

        <Section title="The consumer version of the same bet" intro="Instinct is a personal assistant you text or call, running on a cloud computer with your apps connected — reportedly raising at $10B before a public launch. Its pitch is that memory sticks between tasks and it starts work before you ask. Memory as the moat.">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-line bg-surface p-5">
              <p className="text-[15px] font-semibold">What is right about it</p>
              <p className="mt-2 text-[14.5px] leading-relaxed text-dim">The thesis is correct, and it is ours too: the model is a commodity; what it knows about you is not. An assistant that remembers across tasks is worth more than one that does not, and proactivity is only possible with memory. If they are right that memory is the moat, the question of <em>who holds the moat</em> is the whole argument.</p>
            </div>
            <div className="rounded-2xl border border-accent/45 bg-accent-soft p-5">
              <p className="text-[15px] font-semibold">What a user gives up</p>
              <p className="mt-2 text-[14.5px] leading-relaxed text-ink/85">Everything it learns lives on their cloud computer, under an account with them. You cannot read the record, diff it, or correct a wrong inference; you cannot hand it to a second agent; you cannot take it when you leave. A moat that belongs to the vendor is a moat around <em>you</em>.</p>
            </div>
          </div>
          <p className="mt-4 text-[14.5px] leading-relaxed text-dim">We are not building a competitor to it and we would not integrate into it if we could — there is no public interface, and the closed loop is the point of their product. An Instinct-style agent is a <strong>consumer</strong> of this network the day it resolves a name it does not own. What we build is the thing it would read.</p>
        </Section>

        <Section title="Row by row" intro="Three different bets. Where they are better, it says so.">
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full text-left text-[14.5px]">
              <thead className="text-[13.5px] text-dim"><tr className="border-b border-line"><th className="px-4 py-2 font-medium">Question</th><th className="px-4 py-2 font-medium">Memory platforms<span className="block font-normal opacity-70">Mem0, Supermemory</span></th><th className="px-4 py-2 font-medium">Personal agents<span className="block font-normal opacity-70">Instinct</span></th><th className="px-4 py-2 font-medium text-accent">Knowledge network</th></tr></thead>
              <tbody>{ROWS.map(([q, a, b, c]) => <tr key={q} className="border-b border-line last:border-0 align-top"><td className="px-4 py-3 font-medium">{q}</td><td className="px-4 py-3 text-dim">{a}</td><td className="px-4 py-3 text-dim">{b}</td><td className="px-4 py-3 text-ink/85">{c}</td></tr>)}</tbody>
            </table>
          </div>
        </Section>

        <Section title="Review is a policy, not a tax" intro="The answer to “but they write in milliseconds”.">
          <Callout title="Choose it per namespace" tone="plain">
            <p>On a personal namespace, gating your own claim is friction with no benefit — so the default is <code>approvals: 0</code>: commits land at once, the contradiction check still runs and records, and you review the queue when you like. On <code>cancer-research.eth</code> the gate <em>is</em> the product: drop it and it is a wiki anyone can overwrite. Same primitive, different policy, your choice.</p>
            <p>Publishing is separate from committing for the same reason. A commit is local and instant; a published version is one transaction on an interval or a threshold the namespace sets. Every reader is told the version it got and how old it is.</p>
          </Callout>
        </Section>

        <Section title="What to say in the room">
          <ul className="space-y-2 text-[14px] leading-relaxed">
            {['“Persistent to whom, and for how many versions?”', '“Where does it live when you leave the vendor?”', '“Show me the version before the last overwrite.”', '“Grant my other app read access — without copying.”', '“Two of your extractors disagree. Which one is the record, and who decided?”', '“Your next assistant: does it start from zero?”'].map((l) => <li key={l} className="flex gap-2"><span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-accent" />{l}</li>)}
          </ul>
        </Section>
        <Footer />
      </main>
    </>
  )
}
