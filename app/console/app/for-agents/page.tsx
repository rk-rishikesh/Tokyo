import Link from 'next/link'
import { Callout, CallFlow, Footer, Hero, Section, Steps } from '@/components/Guide'
import { AgentFetch } from '@/components/motion/AgentFetch'

export const metadata = { title: 'For agents' }

export default function ForAgents() {
  return (
    <>
      <Hero kicker="For agents · MCP" title="Give your agent access to the world’s knowledge." sub="One MCP server, many namespaces. The agent names a namespace, resolves it through ENS, and gets claims back with sources, reviewers, confidence and version — context plus provenance, not just text." actions={<Link href="/roles/consumer" className="rounded-full border border-line px-5 py-3 text-[14px] hover:bg-raised">consumer guide</Link>} />
      <main className="w-full px-5 sm:px-8 lg:px-10">
        <Section title="How a call flows">
          <div className="grid items-start gap-6 lg:grid-cols-2">
            <CallFlow
              steps={[
                { title: 'Agent', sub: 'asks a question it needs context for', strong: true },
                { title: 'MCP server', sub: 'runs locally, over stdio — holds no wallet', via: 'knowledge_search({ namespace: "japan.travel.user.eth", query })' },
                { title: 'ENS', sub: 'contenthash(japan.travel.user.eth) → refs: policy, branches, proposals', via: 'resolve the name' },
                { title: 'IPFS', sub: 'the version’s commit objects, each verified by its hash', via: 'public → plaintext · private → needs the key' },
                { title: 'Claims', sub: 'with sources, reviewers, confidence, version and namespace', via: 'retrieve over the current version', strong: true },
              ]}
            />
            <AgentFetch />
          </div>
        </Section>
        <Section title="Attach it" intro="One npm package, run locally by your agent host. No hosting, no account.">
          <Steps steps={[
            { title: 'Add the server to your agent host', body: <>Claude Code shown; any MCP client takes the same command + env.</>, code: `claude mcp add knowledge -e KNOWLEDGE_AGENT=my-agent.eth \\\n  -- npx -y @knowledge01/mcp` },
            { title: 'Resolve, then search', body: <>Start with <code>knowledge_resolve</code> to learn version, policy and roles; then search. Public namespaces need no key.</>, code: `knowledge_resolve({ namespace: "worldhistory.eth" })\nknowledge_search({ namespace: "worldhistory.eth", query: "Indian independence" })\nknowledge_sources({ namespace: "worldhistory.eth", id: "k_9d57e7d6ef72" })` },
            { title: 'Compose namespaces', body: <>Personal + shared + domain in one answer — the agent decides which names to consult.</>, code: `knowledge_search({ namespace: "rishikesh.eth",   query: "food preferences" })\nknowledge_search({ namespace: "japan.travel.user.eth", query: "Tokyo neighbourhoods" })\nknowledge_search({ namespace: "tokyo.food.eth",   query: "vegetarian" })` },
            { title: 'Contribute back', body: <>An agent is a source. Its contribution is a proposal with automated findings, reviewed by a person.</>, code: `knowledge_propose({ namespace: "tokyo.food.eth", title: "Add Saido",\n  items: [{ subject: "Saido", claim: "Saido in Jiyugaoka is a vegan izakaya", topic: "restaurants",\n            sources: [{ kind: "agent", type: "inference", name: "my-agent.eth", excerpt: "…" }] }] })` },
          ]} />
        </Section>
        <Section title="Guarantees, plainly">
          <Callout title="What the agent can rely on" tone="plain">
            <p>Every claim carries its sources, contributor, reviewers, confidence, and the namespace version it came from. Every version is a content-hashed commit reachable from a name whose pointer only the owner can move. Claims are returned as data, fenced and labelled; a claim that tries to instruct the model is reported, not obeyed. The server never holds a funded wallet.</p>
          </Callout>
        </Section>
        <Footer />
      </main>
    </>
  )
}
