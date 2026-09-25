import Link from 'next/link'
import { Callout, Contrast, Footer, Hero, Pipeline, Section, Steps } from '@/components/Guide'
import { Arrow } from '@/components/Arrow'

export const metadata = { title: 'Developers' }

export default function Developers() {
  return (
    <>
      <Hero kicker="Developers" title="Build on the Knowledge Network." sub="Connect your application’s knowledge to an ENS namespace and let other agents and applications consume it. Three surfaces — SDK, CLI, MCP — over one repository." actions={<><Link href="/for-agents" className="rounded-full border border-line px-5 py-3 text-[14px] hover:bg-raised">for agents</Link><Link href="/sources" className="rounded-full border border-line px-5 py-3 text-[14px] hover:bg-raised">sources</Link></>} />
      <main className="w-full px-5 sm:px-8 lg:px-10">
        <Section title="The model your code touches">
          <Pipeline
            caption="A knowledge object keeps its source and provenance for its whole life."
            stages={[
              { title: 'Source', sub: 'who or what said it' },
              { title: 'Contribution', sub: 'a branch and a commit' },
              { title: 'Proposal', sub: 'opened for review' },
              { title: 'Review', sub: 'findings, then a verdict' },
              { title: 'Commit', sub: 'lands as version vN' },
              { title: 'Namespace', sub: 'an ENS name', note: { label: 'consumers', items: ['resolve by name'] } },
              { title: 'IPFS', sub: 'every version, addressable' },
            ]}
          />
        </Section>
        <Section title="The one rule integrators get wrong" intro="Address by what someone would look for; attribute by who said it.">
          <Contrast
            wrong={{ title: 'The writer as a branch of the tree', items: ['swiggy.rishikesh.eth', 'foodagent.rishikesh.eth'] }}
            right={{ title: 'The subject as the name, the writer as the source', items: ['food.rishikesh.eth', 'claim: "Prefers vegetarian food"', 'source: { kind: application, name: Swiggy }'] }}
            why={<>An agent resolves one predictable name and gets everything on that subject, each claim carrying its own source. Per-writer subdomains rebuild the silo with better addresses — nobody looks in <code>foodagent.*</code> and nothing is shared. <code>init</code> warns on vendor- or agent-shaped names; the exception is a source running its own maintained namespace, like <code>wikipedia.history.eth</code>.</>}
          />
        </Section>
        <Section title="Expose your application’s knowledge" intro="Your app is a source. Attach it to a namespace you own, contribute through review, and every agent on the network can read it.">
          <Steps steps={[
            { title: 'Own a namespace', body: <>Register a name (or a child of one you own). Source-specific namespaces are just a convention: <code>tabelog.food.eth</code>, <code>acme.docs.eth</code>.</>, code: `knowledge init tokyo.food.eth --title "Tokyo Food" --register\nknowledge source connect "Tabelog" --kind application --namespace tokyo.food.eth` },
            { title: 'Contribute from code', body: <>The SDK wraps the repository. <code>contribute</code> creates a branch, commits, and opens a proposal — the owner or a reviewer lands it.</>, code: `import { Namespace } from '@recall/repo'\nconst food = Namespace.for('tokyo.food.eth', { agent: 'tabelog-import' })\nfood.contribute({\n  title: 'Nightly sync',\n  items: rows.map((r) => ({ subject: r.name, claim: r.summary, topic: 'restaurants', confidence: 0.85,\n    sources: [{ kind: 'application', type: 'tabelog', name: 'Tabelog', id: r.url }] })),\n})` },
            { title: 'Or import a document source', body: <>The Wikipedia importer is the reference implementation of a document/application source: fetch → sentences → claims with source → proposal.</>, code: `knowledge import wikipedia "Partition of India" --namespace worldhistory.eth\n# → proposal #2, 4 claims, each citing { kind: application, name: Wikipedia, id: <url>, excerpt }` },
            { title: 'Consume in your product', body: <>Read by name. You get the same objects the explorer and agents see.</>, code: `const travel = Namespace.for('japan.travel.eth')\ntravel.search('Tokyo transport')            // Hit[] with sources, reviewers, confidence\ntravel.why(id)                              // provenance across versions\ntravel.version                              // 1` },
            { title: 'Personal namespaces', body: <>Same primitive, encrypted, <code>approvals: 0</code>: writes land at once; findings queue for the owner; conflicts resolve latest-wins by default. Two sources for one claim merge and raise confidence (0.8 + 0.8 → 0.96).</>, code: `const food = Namespace.for('food.rishikesh.eth', { agent: 'swiggy-agent', contentKey })\nfood.observe({ observation: 'Prefers vegetarian food', subject: 'Food', topic: 'preferences', confidence: 0.8,\n  sources: [{ kind: 'application', type: 'observation', name: 'Swiggy', id: 'order-8812' }] })\n// a second app stating the same claim appends its source; a changed fact passes supersedes: <id>` },
            { title: 'Commit is instant; publish is batched', body: <>A commit is a local write in milliseconds. Publishing (one <code>setContenthash</code>) runs on the namespace’s policy — interval, pending-commit threshold, or explicit push. Every pull reports the published version and its age, so a reader always knows it is looking at a snapshot.</>, code: `knowledge push --if-due          # cron-friendly: publishes only when the policy says so\nknowledge_pull → "…v3, published 7 min ago (a snapshot; unpublished commits may exist)"` },
          ]} />
        </Section>
        <Section title="Reference">
          <div className="grid gap-4 md:grid-cols-3">
            {[
              ['SDK · @recall/repo', 'Namespace.for · search · get · all · why · history · contribute · observe · remember · update · forget · repo.* for branches, merge, revert, proposals, policy, sources'],
              ['CLI · knowledge', 'init · add · observe · import wikipedia · get · search · log · status · diff · why · branch · checkout · merge · revert · commit · update · remove · propose · proposals · review · land · policy · source · namespaces · push · pull'],
              ['MCP · knowledge_*', 'resolve · search · get · sources · history · diff · status · propose · review · land · observe · commit · branch · merge · revert · pull · push'],
            ].map(([t, b]) => <div key={t} className="rounded-2xl border border-line bg-surface p-4"><p className="text-[15px] font-semibold">{t}</p><p className="mt-2 text-[14px] leading-relaxed text-dim">{b}</p></div>)}
          </div>
        </Section>
        <Section title="Try the demo application">
          <Callout title="AI Travel Agent">
            <p>A small application that consumes three namespaces — <code>rishikesh.eth</code>, <code>japan.travel.eth</code>, <code>tokyo.food.eth</code> — and plans a trip, showing exactly which claims it used and where each came from. It owns none of the knowledge. <Link href="/demo/travel" className="text-ink underline underline-offset-4 hover:opacity-70">Run it <Arrow /></Link></p>
          </Callout>
        </Section>
        <Footer />
      </main>
    </>
  )
}
