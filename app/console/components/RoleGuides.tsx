/**
 * The four role guides — how it works, how to use it — one component each, so
 * /roles/<role> renders exactly one and /roles lists them.
 */
import type React from 'react'
import Link from 'next/link'
import { Callout, Diagram, Facts, Section, Steps } from '@/components/Guide'

const MCP = ['knowledge_resolve', 'knowledge_search', 'knowledge_get', 'knowledge_sources', 'knowledge_history', 'knowledge_diff', 'knowledge_propose', 'knowledge_review', 'knowledge_land', 'knowledge_observe', 'knowledge_commit', 'knowledge_branch', 'knowledge_merge', 'knowledge_revert', 'knowledge_pull', 'knowledge_push', 'knowledge_status']

export const ROLES = [
  { id: 'owner', who: 'Namespace owner', title: 'Namespace owner', line: 'Controls the name: policy, reviewers, what gets published, which children exist.', tone: 'border-owner/40', text: 'text-owner', dot: 'bg-owner' },
  { id: 'contributor', who: 'Contributor', title: 'Contributor', line: 'Proposes knowledge with sources. Historian, researcher, agent, community member.', tone: 'border-propose/40', text: 'text-propose', dot: 'bg-propose' },
  { id: 'reviewer', who: 'Reviewer / curator', title: 'Reviewer / curator', line: 'Reads the diff and the automated findings, approves or rejects, lands the next version.', tone: 'border-member/40', text: 'text-member', dot: 'bg-member' },
  { id: 'consumer', who: 'Consumer', title: 'Consumer — people, apps and agents', line: 'Resolves the name and reads the current version — with provenance.', tone: 'border-accent/45', text: 'text-accent', dot: 'bg-accent' },
] as const
export type RoleId = (typeof ROLES)[number]['id']

export function InstallSection() {
  return (
        <Section title="Before the roles: install" intro="Node 22+. The CLI, the MCP server and the explorer share one repository directory under ~/.recall.">
          <Steps steps={[{ title: 'Install and build', body: <>The CLI and MCP server bundle to single files.</>, code: `pnpm install\npnpm build:cli && pnpm build:mcp\nalias knowledge="node $PWD/engine/cli/dist/knowledge.mjs"` }]} />
        </Section>
  )
}

export function EdgesSection() {
  return (
        <Section title="Honest about the edges" intro="What is protocol-level today and what is on chain.">
          <Callout title="Roles are enforced by the protocol; the pointer is enforced by ENS" tone="plain">
            <p>Every repository acting on a namespace enforces the published policy: contributors cannot commit to main, only reviewers approve, only the owner changes the policy. What ENS V2 enforces today is narrower and stronger: only the owner’s wallet can move <code>contenthash</code>. Granting reviewers on-chain roles on the resolver is the natural next step and needs nothing new in the object model.</p>
            <p>More on what is proven versus claimed in the <Link href="/faq" className="text-accent hover:underline">FAQ</Link>. Contributions are proposed on a repository the owner or reviewer runs (or through the MCP server they host). A contributor with their own namespace can also publish a fork and ask the owner to pull it — that is what the version graph is for.</p>
          </Callout>
        </Section>
  )
}

export function OwnerGuide() {
  return (
        <Section title="Namespace owner" intro="You control a name and decide how knowledge under it is governed.">
          <div className="grid gap-6 md:grid-cols-[1fr_1.1fr]">
            <Diagram caption="How it works: the name is yours on ENS V2; everything else is a policy you publish with the knowledge.">{`history.eth  (your wallet owns it)
│
├── policy        owner · reviewers · who may propose · approvals · public|private
├── main          v42 — the authoritative version
├── branches      proposals in flight
└── children      india.history.eth, europe.history.eth (each with its own owner and policy)

contenthash(history.eth) → refs → commits on IPFS      ← the ONLY thing you move on chain`}</Diagram>
            <Facts items={[
              { k: 'You own the name, not a server', v: 'history.eth is an ENS V2 name; its registry can hold children; its resolver holds one pointer. Nobody can move that pointer but your wallet.' },
              { k: 'Policy is published', v: 'Reviewers, contributors, approvals and visibility travel with the refs object, so every reader and every reviewer sees the same rules.' },
              { k: 'Public or private', v: 'Public namespaces are plaintext on IPFS — that is the point of history.eth. Private and personal namespaces are encrypted; readers hold the key.' },
              { k: 'Hierarchy', v: 'Register india.history.eth under your registry and hand it to another owner with its own reviewers. The tree is the taxonomy.' },
              { k: 'Name for subjects, not writers', v: 'food.rishikesh.eth, never swiggy.rishikesh.eth or foodagent.rishikesh.eth. Who wrote a claim and where it came from are metadata on the claim. Address by what someone would look for; attribute by who said it. init warns when a child name looks like a vendor or an agent. Exception: a source big enough to maintain its own body of knowledge (wikipedia.history.eth).' },
              { k: 'Review is a policy, not a tax', v: 'Public namespaces gate every write (approvals ≥ 1). Personal ones default to approvals: 0 — writes land instantly, automated review still runs and queues findings for you. Organisation namespaces gate and publish on an interval. Set with --kind at init, change with knowledge policy.' },
            ]} />
          </div>
          <div className="mt-6"><Steps steps={[
            { title: 'Create the namespace', body: <>Local first. Add <code>--register</code> to put it on Sepolia (top-level names go through the ETH registrar and cost test USDC; children register under your parent). Add <code>--private</code> for encrypted knowledge.</>, code: `knowledge init history.eth --title "World History" --description "Collaboratively maintained." --register\nknowledge init india.history.eth --title "History of India" --register     # child, under your registry` },
            { title: 'Set the policy', body: <>Who reviews, who may propose, how many approvals a proposal needs, how unmarked conflicts resolve, when local commits publish, whether approvals must be signed.</>, code: `knowledge init conventions.acme.eth --kind organisation --register\nknowledge policy --reviewer expert.eth --contributors anyone --approvals 1 --conflicts ask --signed-approvals true\nknowledge policy --publish interval --interval-minutes 60 --pending-commits 20` },
            { title: 'Seed it and publish', body: <>Owners and reviewers may commit to <code>main</code> directly. Everyone else proposes. Push encrypts (if private), pins to IPFS and moves the pointer once.</>, code: `knowledge add "India became independent in 1947" --subject "Indian Independence" --topic independence --type event --source book:"India After Gandhi"\nknowledge commit -m "Initial history"\nknowledge push` },
            { title: 'Watch it grow', body: <>Open proposals, contributors and every version are in the explorer: <Link href="/namespaces" className="text-accent hover:underline">/k/history.eth</Link>.</> },
          ]} /></div>
        </Section>
  )
}

export function ContributorGuide() {
  return (
        <Section title="Contributor" intro="You add or correct knowledge. Your claim carries your name and your sources forever.">
          <div className="grid gap-6 md:grid-cols-[1fr_1.1fr]">
            <Diagram caption="How it works: a contribution is a branch with commits and a proposal. It reaches main only through review.">{`main ──●──●──●  v41
            \\
   add-partition ●──●     ← your branch: claims + sources
                    │
                 propose  →  automated review runs
                    │        [contradiction] [missing-sources] …
                 review   →  a reviewer approves
                    │
                  land    →  main v42, reviewers stamped on your claims`}</Diagram>
            <Facts items={[
              { k: 'A claim is the unit', v: 'Subject, claim, topic, type, confidence, sources. Two contributors stating the same claim collapse onto one object — who said it is provenance, not identity.' },
              { k: 'Sources matter', v: 'A claim without sources is flagged by automated review and shown as “unreviewed / no sources” to every reader until fixed. State the same claim as an existing one and your source is appended to it — confidence rises; nothing is duplicated.' },
              { k: 'Changed fact or disagreement?', v: 'If the fact changed, say so: --supersedes <old id>. The old claim is retired and kept; review sees a supersession, not a contradiction. Without it, a differing statement on the same subject is a contradiction and blocks auto-land.' },
              { k: 'No access to the owner’s machine?', v: 'Propose from your own clone and export a bundle: knowledge propose --title … --export --publish. The owner ingests it with knowledge pull-proposal <cid> — every commit verified by hash — and reviews it like any other.' },
              { k: 'You cannot push to main', v: 'Unless the owner made you a reviewer. That is what makes the version number mean something.' },
              { k: 'Agents contribute too', v: 'A research agent uses knowledge_propose with the same shape. Same review, same attribution.' },
            ]} />
          </div>
          <div className="mt-6"><Steps steps={[
            { title: 'Get the namespace', body: <>Pull the published history. For a private namespace the owner gives you the key.</>, code: `knowledge init history.eth && knowledge pull` },
            { title: 'Branch, add with sources, commit', body: <>Work on your own branch. Say who you are with <code>--as</code>.</>, code: `knowledge checkout add-partition -b --as historian-a.eth\nknowledge add "The Partition of India created Pakistan in August 1947" --subject "Partition of India" --topic independence --type event --confidence 0.9 --source book:"Freedom at Midnight" --as historian-a.eth\nknowledge commit -m "Add partition context" --as historian-a.eth` },
            { title: 'Propose', body: <>Opens proposal #n and runs the automated review immediately, so you see what a reviewer will see.</>, code: `knowledge propose --title "Add partition context" --as historian-a.eth\n# automated review:\n#   [missing-sources] …   [contradiction] May contradict existing "…" (60% similar).` },
            { title: 'Or, as an agent', body: <>One MCP call does branch + commit + propose.</>, code: `knowledge_propose({ namespace: "history.eth", title: "Add partition context",\n  items: [{ claim: "…", subject: "Partition of India", topic: "independence", sources: [{ type: "book", title: "Freedom at Midnight" }] }] })` },
          ]} /></div>
        </Section>
  )
}

export function ReviewerGuide() {
  return (
        <Section title="Reviewer / curator" intro="You decide what becomes the next version. Automated review assists; you are the authority.">
          <div className="grid gap-6 md:grid-cols-[1fr_1.1fr]">
            <Diagram caption="How it works: proposal states, and what you see at each.">{`PROPOSED ──► UNDER REVIEW ──► APPROVED ──► COMMITTED
                 │
                 └──► REJECTED

what you see:   the diff, by claim        the previous version
                automated findings        the contributor and their sources
                other reviews             confidence and conflicts`}</Diagram>
            <Facts items={[
              { k: 'Automated review is advisory', v: 'Duplicates, contradictions (same topic and subject, similar claim, different statement), missing sources, low confidence, removals of reviewed claims, and claim changes with no new source.' },
              { k: 'Approvals are counted', v: 'The policy says how many. A contributor cannot approve their own proposal. A reject closes it.' },
              { k: 'Landing stamps you', v: 'Every claim the proposal changed records you as a reviewer. Readers see “reviewed by expert.eth”.' },
              { k: 'Sign it', v: 'knowledge review <n> --approve --sign signs the verdict with the key that owns your ENS name; land verifies the signer against the name’s owner on chain and shows “verified” instead of “claimed”. Namespaces can require it (--signed-approvals true).' },
              { k: 'Nothing is lost', v: 'A rejected proposal keeps its branch. A landed one can be reverted with a new version; history is never rewritten.' },
            ]} />
          </div>
          <div className="mt-6"><Steps steps={[
            { title: 'See what is waiting', body: <>Open proposals with their findings.</>, code: `knowledge proposals --as expert.eth` },
            { title: 'Read the proposal', body: <>The diff by claim, the findings, other reviews.</>, code: `knowledge review 1 --as expert.eth` },
            { title: 'Decide', body: <>Approve, reject, or comment. When approvals reach the policy threshold the proposal is APPROVED.</>, code: `knowledge review 1 --approve -m "Partition context is right; date correction verified." --as expert.eth\nknowledge review 2 --reject  -m "No sources." --as expert.eth` },
            { title: 'Land and publish', body: <>Landing merges onto main as the next version. The owner (or a reviewer with the wallet) pushes.</>, code: `knowledge land 1 --as expert.eth     # history.eth is now v42\nknowledge push` },
            { title: 'In the explorer', body: <>Every proposal has a page: findings, diff, reviews, and the commit it landed as. <Link href="/namespaces" className="text-accent hover:underline">/k/history.eth/reviews</Link></> },
          ]} /></div>
        </Section>
  )
}

export function ConsumerGuide() {
  return (
        <Section title="Consumer — people, apps and agents" intro="You read the current version and can always ask where it came from.">
          <div className="grid gap-6 md:grid-cols-[1fr_1.1fr]">
            <Diagram caption="How it works: resolve the name, fetch the version, answer with provenance.">{`agent: "What happened during Indian independence?"
   │
   ├─ knowledge_resolve("history.eth")        → v42 · owner · policy
   ├─ knowledge_search("history.eth", "…")    → claims with sources, reviewers, confidence
   └─ knowledge_sources(id)                   → introduced in v41 by historian-a.eth, approved by expert.eth

answer:  "India became independent in 1947 … (history.eth v42, 2 sources, reviewed by expert.eth)"`}</Diagram>
            <Facts items={[
              { k: 'No account, no server', v: 'Public namespaces need no key and no wallet. Resolve the ENS name, fetch from IPFS, verify each version’s hash.' },
              { k: 'Claims are data, not instructions', v: 'Everything an agent reads arrives fenced and labelled as retrieved data with its provenance. A claim that says “ignore your instructions” is reported, not obeyed.' },
              { k: 'Compose namespaces', v: 'One server, many names: alice.eth for preferences, tokyo.travel.eth for restaurants. The agent combines them.' },
              { k: 'Updates are automatic', v: 'v42 → v43 is one pointer move. The next query sees the new version.' },
            ]} />
          </div>
          <div className="mt-6"><Steps steps={[
            { title: 'Give an agent the network', body: <>One MCP server serves every namespace; the agent names one per call.</>, code: `claude mcp add knowledge -e KNOWLEDGE_AGENT=my-agent.eth -- npx -y @knowledge01/mcp` },
            { title: 'Read from a terminal', body: <>Pull once, then search offline.</>, code: `knowledge init history.eth && knowledge pull\nknowledge search "Indian independence"\nknowledge why k_6374f147a677        # sources, contributor, reviewers, version` },
            { title: 'Read in the browser', body: <>The explorer shows the same objects: <Link href="/namespaces" className="text-accent hover:underline">/k/history.eth</Link>. A personal namespace also has a plain-language view at <code>/me/&lt;name&gt;</code>.</> },
            { title: 'Build an application', body: <>The SDK is a thin facade over the same repository.</>, code: `import { Namespace } from '@knowledge01/repo'\nconst history = Namespace.for('history.eth')\nhistory.search('Indian independence')                 // Hit[] with sources and reviewers\nhistory.contribute({ title: 'Add partition context', items: [...] })   // → proposal\n\nconst alice = Namespace.for('alice.eth', { agent: 'shopping-agent' })  // personal memory\nalice.observe({ observation: 'User prefers Nike running shoes', topic: 'shopping', confidence: 0.87 })` },
          ]} /></div>
          <div className="mt-4 rounded-2xl border border-line bg-surface p-4"><p className="text-[12.5px] font-medium uppercase tracking-wider text-dim">MCP tools</p><p className="mt-2 flex flex-wrap gap-1.5">{MCP.map((t) => <code key={t} className="rounded bg-raised px-2 py-0.5 font-mono text-[13.5px]">{t}</code>)}</p></div>
        </Section>
  )
}

export const GUIDES: Record<RoleId, () => React.ReactElement> = { owner: OwnerGuide, contributor: ContributorGuide, reviewer: ReviewerGuide, consumer: ConsumerGuide }
