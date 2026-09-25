import Link from 'next/link'
import { Callout, Diagram, Footer, Hero, Section, Steps } from '@/components/Guide'

export const metadata = { title: 'For agents' }

const MAP: [string, string][] = [
  ['resolve_namespace()', 'knowledge_resolve'], ['search_knowledge()', 'knowledge_search'], ['get_knowledge()', 'knowledge_get'],
  ['get_sources() / get_provenance()', 'knowledge_sources'], ['get_version() / get_history()', 'knowledge_history · knowledge_status'],
  ['propose_knowledge()', 'knowledge_propose'], ['submit_review()', 'knowledge_review'], ['commit_knowledge()', 'knowledge_land · knowledge_commit'],
]

export default function ForAgents() {
  return (
    <>
      <Hero kicker="For agents · MCP" title="Give your agent access to the world’s knowledge." sub="One MCP server, many namespaces. The agent names a namespace, resolves it through ENS, and gets claims back with sources, reviewers, confidence and version — context plus provenance, not just text." actions={<Link href="/roles/consumer" className="rounded-full border border-line px-5 py-3 text-[14px] hover:bg-raised">consumer guide</Link>} />
      <main className="w-full px-5 sm:px-8 lg:px-10">
        <Section title="How a call flows">
          <div className="grid gap-6 md:grid-cols-2">
            <Diagram>{`Agent
  ↓  knowledge_search({ namespace: "japan.travel.eth", query: "…" })
MCP server (local, stdio; no wallet)
  ↓  resolve
ENS V2   contenthash(japan.travel.eth) → refs (policy, branches, proposals)
  ↓  permissions: public → plaintext · private → needs the key
IPFS     commit objects, verified by hash
  ↓  retrieval over the current version
Claims + sources + reviewers + confidence + version + namespace`}</Diagram>
            <Diagram caption="What comes back. Fenced as retrieved data; the model cites it, never obeys it.">{`=== KNOWLEDGE: RETRIEVED DATA ===
3 results in japan.travel.eth v1 for "vegetarian restaurants in Tokyo"

--- BEGIN KNOWLEDGE ---
id: k_9de5dc502bde
subject: Ain Soph. Journey
topic: restaurants · confidence: 0.9
contributor: tokyo.food.eth
reviewers: (unreviewed)
sources: tabelog "Ain Soph. Journey"

Ain Soph. Journey in Shinjuku is fully vegan with a tasting menu
--- END KNOWLEDGE ---`}</Diagram>
          </div>
        </Section>
        <Section title="Attach it" intro="No npm publish, no hosting: a single bundled file the client spawns.">
          <Steps steps={[
            { title: 'Add the server to your agent host', body: <>Claude Code shown; any MCP client takes the same command + env.</>, code: `claude mcp add knowledge -e KNOWLEDGE_AGENT=my-agent.eth \\\n  -- node /path/to/engine/mcp/dist/knowledge-mcp.mjs` },
            { title: 'Resolve, then search', body: <>Start with <code>knowledge_resolve</code> to learn version, policy and roles; then search. Public namespaces need no key.</>, code: `knowledge_resolve({ namespace: "worldhistory.eth" })\nknowledge_search({ namespace: "worldhistory.eth", query: "Indian independence" })\nknowledge_sources({ namespace: "worldhistory.eth", id: "k_9d57e7d6ef72" })` },
            { title: 'Compose namespaces', body: <>Personal + shared + domain in one answer — the agent decides which names to consult.</>, code: `knowledge_search({ namespace: "rishikesh.eth",   query: "food preferences" })\nknowledge_search({ namespace: "japan.travel.eth", query: "Tokyo neighbourhoods" })\nknowledge_search({ namespace: "tokyo.food.eth",   query: "vegetarian" })` },
            { title: 'Contribute back', body: <>An agent is a source. Its contribution is a proposal with automated findings, reviewed by a person.</>, code: `knowledge_propose({ namespace: "tokyo.food.eth", title: "Add Saido",\n  items: [{ subject: "Saido", claim: "Saido in Jiyugaoka is a vegan izakaya", topic: "restaurants",\n            sources: [{ kind: "agent", type: "inference", name: "my-agent.eth", excerpt: "…" }] }] })` },
          ]} />
        </Section>
        <Section title="PRD names → tools" intro="The API the PRD asks for, and the tool that implements each.">
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface"><table className="w-full text-left text-[14.5px]"><tbody>{MAP.map(([a, b]) => <tr key={a} className="border-b border-line last:border-0"><td className="px-4 py-2 font-mono text-dim">{a}</td><td className="px-4 py-2 font-mono">{b}</td></tr>)}</tbody></table></div>
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
