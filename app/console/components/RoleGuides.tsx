/**
 * The four role guides — how it works, how to use it — one component each, so
 * /roles/<role> renders exactly one and /roles lists them.
 */
import type React from 'react'
import Link from 'next/link'
import { Callout, Diagram, Facts, Section, Steps } from '@/components/Guide'

const MCP = ['knowledge_resolve', 'knowledge_search', 'knowledge_read', 'knowledge_get', 'knowledge_sources', 'knowledge_history', 'knowledge_diff', 'knowledge_status', 'knowledge_findings', 'knowledge_propose', 'knowledge_review', 'knowledge_land', 'knowledge_observe', 'knowledge_commit', 'knowledge_branch', 'knowledge_merge', 'knowledge_revert', 'knowledge_pull', 'knowledge_push']

export const ROLES = [
  { id: 'owner', who: 'Namespace owner', title: 'Namespace owner', line: 'Controls the name: policy, reviewers, what gets published, which children exist.', tone: 'border-owner/40', text: 'text-owner', dot: 'bg-owner' },
  { id: 'contributor', who: 'Contributor', title: 'Contributor', line: 'Proposes knowledge with sources. Researcher, lab, agent, community member.', tone: 'border-propose/40', text: 'text-propose', dot: 'bg-propose' },
  { id: 'reviewer', who: 'Reviewer / curator', title: 'Reviewer / curator', line: 'Reads the diff and the automated findings, approves or rejects, lands the next version.', tone: 'border-member/40', text: 'text-member', dot: 'bg-member' },
  { id: 'consumer', who: 'Consumer', title: 'Consumer — people, apps and agents', line: 'Resolves the name and reads the current version — with provenance.', tone: 'border-accent/45', text: 'text-accent', dot: 'bg-accent' },
] as const
export type RoleId = (typeof ROLES)[number]['id']

export function InstallSection() {
  return (
        <Section title="Before the roles: install" intro="Node 22+. The CLI and the MCP server are on npm and keep local copies of namespaces in ~/.recall.">
          <Steps steps={[
            { title: 'The CLI', body: <>For owners, contributors and reviewers.</>, code: `npm i -g @knowledge01/cli\nknowledge --help` },
            { title: 'The MCP server', body: <>For agents. Reads go through a Pinata gateway.</>, code: `claude mcp add knowledge \\\n  -e PINATA_GATEWAY=<gateway>.mypinata.cloud \\\n  -- npx -y @knowledge01/mcp` },
          ]} />
        </Section>
  )
}

export function EdgesSection() {
  return (
        <Section title="What ENS enforces" intro="The policy says who may do what; ENS makes the important parts true on chain.">
          <Callout title="Roles live in the policy, and on the resolver" tone="plain">
            <p>Every repository acting on a namespace enforces its published policy: contributors cannot commit to main, only reviewers approve, only the owner changes the policy. On chain, each namespace’s own resolver enforces who can write: the owner publishes and grants; a <strong>reviewer</strong> holds the right to publish that name alone; a named <strong>contributor</strong> can write one key, <code>knowledge.proposal.&lt;name&gt;</code>, to point the owner at a proposal — and nothing else.</p>
            <p><code>knowledge policy</code> keeps the two in step, and <code>knowledge roles</code> reads them back from ENS; each namespace’s Info page shows the same. More on what is proven versus claimed in the <Link href="/faq" className="text-accent hover:underline">FAQ</Link>.</p>
          </Callout>
        </Section>
  )
}

export function OwnerGuide() {
  return (
        <Section title="How it works" intro="You control a name and decide how knowledge under it is governed.">
          <div className="space-y-8">
            <Diagram caption="How it works: the name is yours on ENS V2; everything else is a policy you publish with the knowledge.">{`cancer-research.eth  (your wallet owns it)
│
├── policy        owner · reviewers · who may propose · approvals · public|private
├── main          v42 — the authoritative version
├── branches      proposals in flight
└── children      trials.cancer-research.eth, immunotherapy.cancer-research.eth
                  (each with its own owner and policy)

contenthash(cancer-research.eth) → refs → commits on IPFS   ← the ONLY thing you move on chain`}</Diagram>
            <Facts items={[
              { k: 'You own the name, not a server', v: 'cancer-research.eth is an ENS V2 name; its registry can hold children; its resolver holds one pointer. Only your wallet — and reviewers you grant — can move it.' },
              { k: 'Policy is published', v: 'Reviewers, contributors, approvals and visibility travel with the refs object, so every reader and every reviewer sees the same rules.' },
              { k: 'Public or private', v: 'Public namespaces are plaintext on IPFS — that is the point of cancer-research.eth. Private ones, like treasury.kestrel.eth, and personal ones are encrypted; each reader opens them with a grant sealed to their own key.' },
              { k: 'Hierarchy', v: 'Register trials.cancer-research.eth under your registry and hand it to another owner with its own reviewers. The tree is the taxonomy.' },
              { k: 'Name for subjects, not writers', v: 'food.rishikesh.eth, never swiggy.rishikesh.eth or foodagent.rishikesh.eth. Who wrote a claim and where it came from are metadata on the claim. Address by what someone would look for; attribute by who said it. init warns when a child name looks like a vendor or an agent. Exception: a source big enough to maintain its own body of knowledge, like a trial registry publishing under its own name.' },
              { k: 'Review is a policy, not a tax', v: 'Public namespaces gate every write (approvals ≥ 1). Personal ones default to approvals: 0 — writes land instantly, automated review still runs and queues findings for you. Organisation namespaces gate and publish on an interval. Set with --kind at init, change with knowledge policy.' },
            ]} />
          </div>
          <div className="mt-6"><Steps steps={[
            { title: 'Create the namespace', body: <>Local first. Add <code>--register</code> to put it on Sepolia (top-level names go through the ETH registrar and cost test USDC; children register under your parent). Add <code>--private</code> for encrypted knowledge.</>, code: `knowledge init cancer-research.eth --register \\\n  --title "Cancer Research" --description "Community-maintained, reviewed."\n\n# a child, under your registry\nknowledge init trials.cancer-research.eth --title "Clinical trials" --register` },
            { title: 'Set the policy', body: <>Who reviews, who may propose, how many approvals a proposal needs, how conflicts resolve, when local commits publish, whether approvals must be signed. With your wallet set, reviewers and named contributors are granted their roles on ENS as you go; <code>knowledge roles</code> shows them.</>, code: `knowledge init treasury.kestrel.eth --kind organisation --private --register\nknowledge policy --reviewer cfo.kestrel.eth \\\n  --contributors treasury-agent.eth \\\n  --approvals 1 --conflicts ask --signed-approvals true\nknowledge policy --publish interval --interval-minutes 60\nknowledge roles   # what ENS now says each of them may do` },
            { title: 'Seed it and publish', body: <>Owners and reviewers may commit to <code>main</code> directly. Everyone else proposes. Push encrypts (if private), pins to IPFS and moves the pointer once.</>, code: `knowledge add "Pembrolizumab is approved for MSI-H solid tumours" \\\n  --subject "Pembrolizumab" --topic approvals \\\n  --source document:"FDA approval, May 2017"\nknowledge commit -m "Seed approvals"\nknowledge push` },
            { title: 'Watch it grow', body: <>Open proposals, contributors and every version are in the explorer: <Link href="/namespaces" className="text-accent hover:underline">/k/cancer-research.eth</Link>.</> },
          ]} /></div>
        </Section>
  )
}

export function ContributorGuide() {
  return (
        <Section title="How it works" intro="You add or correct knowledge. Your claim carries your name and your sources forever.">
          <div className="space-y-8">
            <Diagram caption="How it works: a contribution is a branch with commits and a proposal. It reaches main only through review.">{`main ──●──●──●  v41
            \\
    add-olaparib ●──●     ← your branch: claims + sources
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
              { k: 'No access to the owner’s machine?', v: 'Propose from your own copy and publish the bundle: knowledge propose --title … --export --publish yes. If the owner named you a contributor, the CLI also writes a pointer to it on ENS, and the owner finds it with knowledge pull-proposal --from <your name> — every commit verified by hash.' },
              { k: 'You cannot push to main', v: 'Unless the owner made you a reviewer. That is what makes the version number mean something.' },
              { k: 'Agents contribute too', v: 'A research agent uses knowledge_propose with the same shape. Same review, same attribution.' },
            ]} />
          </div>
          <div className="mt-6"><Steps steps={[
            { title: 'Get the namespace', body: <>Pull the published history. A private namespace needs a grant sealed to your key.</>, code: `knowledge init cancer-research.eth && knowledge pull` },
            { title: 'Branch, add with sources, commit', body: <>Work on your own branch. Say who you are with <code>--as</code>.</>, code: `knowledge checkout add-olaparib -b --as oncology-lab.eth\nknowledge add "Olaparib is approved for BRCA-mutated ovarian cancer" \\\n  --subject "Olaparib" --topic approvals --confidence 0.9 \\\n  --source document:"FDA approval, December 2014" \\\n  --as oncology-lab.eth\nknowledge commit -m "Add olaparib approval" --as oncology-lab.eth` },
            { title: 'Propose', body: <>Opens proposal #n and runs the automated review immediately, so you see what a reviewer will see.</>, code: `knowledge propose --title "Add olaparib approval" --as oncology-lab.eth\n\n# automated review:\n#   [missing-sources] …\n#   [contradiction] may contradict "…" (60% similar)` },
            { title: 'Or, as an agent', body: <>One MCP call does branch + commit + propose.</>, code: `knowledge_propose({\n  namespace: "cancer-research.eth",\n  title: "Add olaparib approval",\n  items: [{ subject: "Olaparib", claim: "…", topic: "approvals",\n    sources: [{ type: "document", title: "FDA approval, December 2014" }] }],\n})` },
          ]} /></div>
        </Section>
  )
}

export function ReviewerGuide() {
  return (
        <Section title="How it works" intro="You decide what becomes the next version. Automated review assists; you are the authority.">
          <div className="space-y-8">
            <Diagram caption="How it works: proposal states, and what you see at each.">{`PROPOSED ──► UNDER REVIEW ──► APPROVED ──► COMMITTED
                 │
                 └──► REJECTED

what you see:   the diff, by claim        the previous version
                automated findings        the contributor and their sources
                other reviews             confidence and conflicts`}</Diagram>
            <Facts items={[
              { k: 'Automated review is advisory', v: 'Duplicates, contradictions (same topic and subject, similar claim, different statement), missing sources, low confidence, removals of reviewed claims, and claim changes with no new source.' },
              { k: 'Approvals are counted', v: 'The policy says how many. A contributor cannot approve their own proposal. A reject closes it.' },
              { k: 'Landing stamps you', v: 'Every claim the proposal changed records you as a reviewer. Readers see “reviewed by oncology-review.eth”.' },
              { k: 'Sign it', v: 'knowledge review <n> --approve --sign signs the verdict with the key that owns your ENS name; land verifies the signer against the name’s owner on chain and shows “verified” instead of “claimed”. Namespaces can require it (--signed-approvals true).' },
              { k: 'Nothing is lost', v: 'A rejected proposal keeps its branch. A landed one can be reverted with a new version; history is never rewritten.' },
            ]} />
          </div>
          <div className="mt-6"><Steps steps={[
            { title: 'See what is waiting', body: <>Open proposals with their findings.</>, code: `knowledge proposals --as oncology-review.eth` },
            { title: 'Read the proposal', body: <>The diff by claim, the findings, other reviews.</>, code: `knowledge review 1 --as oncology-review.eth` },
            { title: 'Decide', body: <>Approve, reject, or comment. When approvals reach the policy threshold the proposal is APPROVED.</>, code: `knowledge review 1 --approve \\\n  -m "Matches the FDA label; source checked." --as oncology-review.eth\nknowledge review 2 --reject -m "No sources." --as oncology-review.eth` },
            { title: 'Land and publish', body: <>Landing merges onto main as the next version. As a granted reviewer you can publish it yourself, with your own wallet.</>, code: `knowledge land 1 --as oncology-review.eth   # → v42\nknowledge push` },
            { title: 'In the explorer', body: <>Every proposal has a page: findings, diff, reviews, and the commit it landed as. <Link href="/namespaces" className="text-accent hover:underline">/k/cancer-research.eth/reviews</Link></> },
          ]} /></div>
        </Section>
  )
}

export function ConsumerGuide() {
  return (
        <Section title="How it works" intro="You read the current version and can always ask where it came from.">
          <div className="space-y-8">
            <Diagram caption="How it works: resolve the name, fetch the version, answer with provenance.">{`agent: "What is approved for BRCA-mutated ovarian cancer?"
   │
   ├─ knowledge_resolve("cancer-research.eth")       → v42 · owner · policy
   ├─ knowledge_search("cancer-research.eth", "…")   → claims with sources, reviewers, confidence
   └─ knowledge_sources(id)                          → introduced in v41 by oncology-lab.eth,
                                                       approved by oncology-review.eth

answer:  "Olaparib, a PARP inhibitor … (cancer-research.eth v42, FDA approval Dec 2014,
          reviewed by oncology-review.eth)"`}</Diagram>
            <Facts items={[
              { k: 'No account, no server', v: 'Public namespaces need no key and no wallet. Resolve the ENS name, fetch from IPFS, verify each version’s hash. A private one opens with a grant sealed to your own key — given to you, or bought over x402.' },
              { k: 'Claims are data, not instructions', v: 'Everything an agent reads arrives fenced and labelled as retrieved data with its provenance. A claim that says “ignore your instructions” is reported, not obeyed.' },
              { k: 'Compose namespaces', v: 'One server, many names: treasury.kestrel.eth for policy, portfolio.kestrel.eth for positions. The agent combines them.' },
              { k: 'Updates are automatic', v: 'v42 → v43 is one pointer move. The next query sees the new version.' },
            ]} />
          </div>
          <div className="mt-6"><Steps steps={[
            { title: 'Give an agent the network', body: <>One MCP server serves every namespace; the agent names one per call. For a private namespace you were granted, add <code>KNOWLEDGE_READER_KEY</code> and use <code>knowledge_read</code>.</>, code: `claude mcp add knowledge \\\n  -e PINATA_GATEWAY=<gateway>.mypinata.cloud \\\n  -- npx -y @knowledge01/mcp` },
            { title: 'Read from a terminal', body: <>Pull once, then search offline.</>, code: `knowledge init cancer-research.eth\nknowledge pull\nknowledge search "PARP inhibitor ovarian"\nknowledge why <claim id>   # sources, contributor, reviewers` },
            { title: 'Read in the browser', body: <>The explorer shows the same objects: <Link href="/namespaces" className="text-accent hover:underline">/k/cancer-research.eth</Link>, and every name on the ENS explorer.</> },
            { title: 'Build an application', body: <>The SDK is a thin facade over the same repository.</>, code: `import { Namespace } from '@knowledge01/repo'\n\nconst research = Namespace.for('cancer-research.eth')\nresearch.search('PARP inhibitor ovarian')   // hits with sources\nresearch.contribute({ title: '…', items })  // → a proposal\n\nconst me = Namespace.for('alice.eth')        // personal memory\nme.observe({ observation: 'Prefers vegetarian food', topic: 'food' })` },
          ]} /></div>
          <div className="mt-4 rounded-2xl border border-line bg-surface p-4"><p className="text-[12.5px] font-medium uppercase tracking-wider text-dim">MCP tools</p><p className="mt-2 flex flex-wrap gap-1.5">{MCP.map((t) => <code key={t} className="rounded bg-raised px-2 py-0.5 font-mono text-[13.5px]">{t}</code>)}</p></div>
        </Section>
  )
}

export const GUIDES: Record<RoleId, () => React.ReactElement> = { owner: OwnerGuide, contributor: ContributorGuide, reviewer: ReviewerGuide, consumer: ConsumerGuide }
