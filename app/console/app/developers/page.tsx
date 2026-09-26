import Link from 'next/link'
import { Callout, Contrast, Footer, Hero, Pipeline, Section, Steps } from '@/components/Guide'
import { Arrow } from '@/components/Arrow'

export const metadata = { title: 'Developers' }

export default function Developers() {
  return (
    <>
      <Hero kicker="Developers" title="Build on the Knowledge Network." sub="Connect your application’s knowledge to an ENS namespace and let other agents and applications consume it. Three surfaces — SDK, CLI, MCP - One Knowledge Network" actions={<><Link href="/for-agents" className="rounded-full border border-line px-5 py-3 text-[14px] hover:bg-raised">for agents</Link><Link href="/sources" className="rounded-full border border-line px-5 py-3 text-[14px] hover:bg-raised">sources</Link></>} />
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
        <Section title="How to create subdomains" intro="Name a subdomain by what someone would look for; record who wrote each claim as its source.">
          <Contrast
            wrong={{ title: 'The writer as a branch of the tree', items: ['swiggy.rishikesh.eth', 'foodagent.rishikesh.eth'] }}
            right={{ title: 'The subject as the name, the writer as the source', items: ['food.rishikesh.eth', 'claim: "Prefers vegetarian food"', 'source: { kind: application, name: Swiggy }'] }}
            why={<>An agent resolves one predictable name and gets everything on that subject, each claim carrying its own source. Per-writer subdomains rebuild the silo with better addresses — nobody looks in <code>foodagent.*</code> and nothing is shared. <code>init</code> warns on vendor- or agent-shaped names; the exception is a source running its own maintained namespace, like a trial registry publishing under its own name.</>}
          />
          <div className="mt-6"><Steps steps={[
            { title: 'Create it under a name you own', body: <>A subdomain gets its own registry and resolver, so it can have its own owner, reviewers and children. Your wallet must own the parent.</>, code: `knowledge init food.yourname.eth --title "Food" --register\nknowledge init work.yourname.eth --title "Work" --kind organisation --register\nknowledge init trials.research.yourorg.eth --register       # nests as deep as you need` },
          ]} /></div>
        </Section>
        <Section title="Integrate" intro="Three npm packages, one network. Pick the one that matches where your code runs.">
          <Steps steps={[
            {
              title: 'Give your agent the network — @knowledge01/mcp',
              body: <>One MCP server serves every namespace; the agent names one per call. <code>PINATA_GATEWAY</code> is required; add <code>KNOWLEDGE_AGENT</code> to sign what it proposes, and <code>KNOWLEDGE_READER_KEY</code> to open a private namespace it was granted. Any MCP client takes the same command and environment.</>,
              code: `claude mcp add knowledge \\
  -e PINATA_GATEWAY=<gateway>.mypinata.cloud \\
  -e KNOWLEDGE_AGENT=<your-agent>.eth \\
  -- npx -y @knowledge01/mcp

# then, from the agent
knowledge_search({ namespace: "cancer-research.eth", query: "PARP inhibitor" })
knowledge_read({ namespace: "signals.treasury.eth" })        // sealed: opens with its grant
knowledge_propose({ namespace: "cancer-research.eth", title: "…", items: [...] })`,
            },
            {
              title: 'Own and publish from a terminal — @knowledge01/cli',
              body: <>Create a namespace on ENS, set who reviews and who may propose, and publish. <code>PRIVATE_KEY</code> is the wallet that owns the name; reading needs none.</>,
              code: `npm i -g @knowledge01/cli

knowledge init research.yourorg.eth --title "Research" --register
knowledge policy --reviewer reviewer.eth --contributors anyone --approvals 1
knowledge add "…" --subject "…" --topic "…" --source document:"…"
knowledge commit -m "Seed" && knowledge push       # one setContenthash
knowledge roles                                   # who may publish or propose, read from ENS`,
            },
            {
              title: 'Read from the network in your app — @knowledge01/repo',
              body: <>Resolve a name on ENS, fetch its current version from IPFS and verify every object by its hash. No account and no server of ours; set <code>PINATA_GATEWAY</code>, and a private namespace opens with a grant sealed to your key.</>,
              code: `npm i @knowledge01/repo @knowledge01/storage viem
export PINATA_GATEWAY=<gateway>.mypinata.cloud

import { ensNetwork, resolveNamespace } from '@knowledge01/repo'
import { createStorage } from '@knowledge01/storage'
import { createPublicClient, http } from 'viem'
import { sepolia } from 'viem/chains'

const network = ensNetwork({ storage: createStorage(), client: createPublicClient({ chain: sepolia, transport: http() }) })
const ns = await resolveNamespace(network, 'cancer-research.eth', null)   // or { privateKey } for a grant
ns.version   // 2
ns.claims    // each with sources, contributor, reviewers, confidence`,
            },
            {
              title: 'Contribute from your app — the same package',
              body: <>Write through a local repository: a contribution becomes a proposal with automated findings, reviewed before it lands; personal memory can take observations directly.</>,
              code: `import { Namespace } from '@knowledge01/repo'

const research = Namespace.for('cancer-research.eth', { agent: 'your-app.eth' })
research.contribute({ title: 'Add olaparib', items: [{ subject: 'Olaparib', claim: '…', topic: 'approvals',
  sources: [{ type: 'document', title: 'FDA approval, December 2014' }] }] })   // → proposal #n

const me = Namespace.for('alice.eth', { agent: 'your-app.eth' })
me.observe({ observation: 'Prefers vegetarian food', topic: 'food', confidence: 0.9 })`,
            },
          ]} />
          <div className="mt-8">
            <p className="text-[12px] font-medium uppercase tracking-[0.1em] text-dim">Read more</p>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              {[
                { href: '/roles', title: 'Roles & guides', body: 'Owner, contributor, reviewer and consumer — how each works, with commands.' },
                { href: '/roles/consumer', title: 'All 19 MCP tools', body: 'What an agent can call, and how it reads a private namespace it was granted.' },
                { href: 'https://www.npmjs.com/org/knowledge01', title: 'The packages on npm', body: '@knowledge01/cli, mcp, repo, storage and core. Run knowledge --help for every command.' },
              ].map((c) => (
                <Link key={c.href} href={c.href} {...(c.href.startsWith('http') ? { target: '_blank', rel: 'noreferrer' } : {})}
                  className="group rounded-2xl border border-line bg-surface p-5 transition-colors hover:border-ink/30">
                  <span className="flex items-center justify-between text-[15px] font-medium">{c.title}<Arrow /></span>
                  <span className="mt-1.5 block text-[13.5px] leading-relaxed text-dim">{c.body}</span>
                </Link>
              ))}
            </div>
          </div>
        </Section>
        <Footer />
      </main>
    </>
  )
}
