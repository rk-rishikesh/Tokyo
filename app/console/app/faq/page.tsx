import Link from 'next/link'
import { Footer, Hero } from '@/components/Guide'

export const metadata = { title: 'FAQ — honest answers' }

type QA = { q: string; a: React.ReactNode }

const GROUPS: { title: string; items: QA[] }[] = [
  {
    title: 'Identity and trust',
    items: [
      {
        q: 'When I run knowledge review --approve --as expert.eth, how does the system know I am expert.eth?',
        a: <>
          <p>Today it does not. <code>--as expert.eth</code> (or <code>KNOWLEDGE_AGENT</code> for the MCP server) is a <strong>claim, not a proof</strong>. Anyone with access to the repository could type it. The roles in the policy — owner, reviewers, contributors — are enforced by every repository that acts on the namespace, which is real protection against mistakes and against agents overstepping, but not against a person who controls the machine and wants to lie.</p>
          <p>What <em>is</em> enforced cryptographically is narrower and stronger: only the wallet that owns the ENS name holds <code>SET_CONTENTHASH</code> on its resolver, so <strong>only the owner can publish a version</strong>. Everything a reader sees on <code>worldhistory.eth</code> got there because the owner’s key moved the pointer.</p>
          <p>The natural next step, which needs nothing new in the object model: reviewers sign their approvals with the key that owns their ENS name, and <code>land</code> verifies the signature — or reviewers hold a role on the namespace’s resolver and approvals are checked on chain. Until then, treat “reviewed by expert.eth” as “recorded as reviewed by expert.eth on the owner’s repository”.</p>
        </>,
      },
      {
        q: 'Do I need a different wallet for each role?',
        a: <p>No. One wallet — the namespace owner’s — is enough, and it is used for exactly two things: registering the name (<code>knowledge init --register</code>) and publishing (<code>knowledge push</code>). Contributor, reviewer and consumer are names in the policy, not wallets. The live demo namespaces were built with a single wallet.</p>,
      },
      {
        q: 'Who can publish, then?',
        a: <p>Only the owner’s wallet. A reviewer can approve and land a proposal locally, but the new version becomes visible to the network only when the owner pushes. If you want reviewers to publish, share the wallet or — better — grant them the resolver role on chain; the code already reads roles from the resolver.</p>,
      },
    ],
  },
  {
    title: 'What is on chain, what is not',
    items: [
      {
        q: 'What exactly lives on ENS?',
        a: <p>Per namespace: the name, a UserRegistry (so it can have children with their own owners), a PermissionedResolver, and one record — <code>contenthash</code> — pointing at the current refs object on IPFS. Nothing else. Claims, commits, policy, proposals and reviews are all in the refs object and the commit objects, which are content-addressed and verified by hash when fetched.</p>,
      },
      {
        q: 'Is the policy enforced on chain?',
        a: <p>No. The policy (who reviews, who may propose, how many approvals) is part of the published refs, so every reader and every repository sees the same rules and enforces them locally. ENS enforces ownership of the pointer. That split is deliberate for the MVP; per-role on-chain enforcement is the hardening step described above.</p>,
      },
      {
        q: 'Can history be rewritten?',
        a: <p>Not without leaving evidence. Every commit’s id is the SHA-256 of its content, including its parents. A reader who has seen v42 can check that v43 descends from it. The owner <em>could</em> point the name at a different history — that would be a visible break in the chain, not a silent edit. Within a history, <code>revert</code> adds a new version; nothing is deleted.</p>,
      },
      {
        q: 'Is the content encrypted?',
        a: <p>Public namespaces (<code>worldhistory.eth</code>) are stored in plaintext on IPFS on purpose — any agent should be able to read them. Private and personal namespaces (<code>--private</code>, e.g. <code>alice.eth</code>) are AES-256-GCM encrypted before pinning; readers hold the namespace key. No plaintext personal memory ever reaches public IPFS.</p>,
      },
    ],
  },
  {
    title: 'Review',
    items: [
      {
        q: 'Is the “automated review” an AI?',
        a: <p>No large language model is involved, and that is deliberate. It is a deterministic engine that compares a proposal with the base branch: duplicates, contradictions (same topic and subject, similar claim, different statement), missing sources, low confidence, removals of reviewed claims, and claim edits with no new source. It is advisory — findings are shown to the reviewer, who decides. An LLM-assisted reviewer could be plugged in as another source of findings without changing the workflow.</p>,
      },
      {
        q: 'Can a contributor approve their own proposal?',
        a: <p>No, unless they are the owner. Approvals from the same reviewer count once, and the policy says how many are needed. A reject closes the proposal; its branch stays so nothing is lost.</p>,
      },
    ],
  },
  {
    title: 'Using it',
    items: [
      {
        q: 'How is this different from an agent-memory platform? Theirs is persistent too.',
        a: <>
          <p>It is — persistent in the sense they claim: the memory survives the session. What it is not is durable in your hands. It is <strong>not portable</strong> (keyed to a vendor’s user id in a vendor database), <strong>not immutable</strong> (a later extraction silently overwrites; no version, no diff, no undo), and <strong>not sovereign</strong> (you hold no key and cannot grant another app read access without copying). Persistent for the application, not for you.</p>
          <p>The test that separates the two: <em>would a second party want to know where this came from?</em> Memory is a byproduct of one interaction with one principal. Knowledge is authored, has a truth condition, and is read by people who were not there. Knowledge needs sources, a reviewer and a version; memory does not — which is why personal namespaces here default to <code>approvals: 0</code> and land instantly. <Link href="/compare/memory" className="text-ink underline underline-offset-4 hover:opacity-70">Row by row.</Link></p>
        </>,
      },
      {
        q: 'Do I need to build an application to use this?',
        a: <p>No. The consuming application is any MCP-capable assistant — Claude Code, Cursor and others — with the <code>knowledge</code> server attached. It resolves the name, searches, cites sources and reviewers, and can open proposals. The SDK (<code>Namespace.for(&apos;worldhistory.eth&apos;)</code>) is the same primitive for people who do want to build; see <Link href="/roles/consumer" className="text-ink underline underline-offset-4 hover:opacity-70">the consumer guide</Link>.</p>,
      },
      {
        q: 'Do I need to publish the MCP server to npm?',
        a: <p>No. It is a single bundled file that a client spawns locally over stdio: <code>claude mcp add knowledge -- npx -y @k01/mcp</code>. Search works offline against the local repositories; only pull and push touch the network.</p>,
      },
      {
        q: 'Why worldhistory.eth and not history.eth?',
        a: <p><code>history.eth</code> is already registered by someone else on Sepolia. The demo namespace is <code>worldhistory.eth</code> with the child <code>india.worldhistory.eth</code>. The CLI refuses to adopt a name owned by another wallet.</p>,
      },
      {
        q: 'How does another agent see a new version?',
        a: <p>Publishing moves one pointer. The next <code>knowledge_pull</code> (or <code>knowledge pull</code>) resolves the name, fetches the new refs and only the commits it does not have yet, and fast-forwards. There is no cache to invalidate and no server to notify.</p>,
      },
    ],
  },
  {
    title: 'Not built yet',
    items: [
      {
        q: 'What is explicitly missing?',
        a: <ul className="list-disc space-y-1 pl-5">
          <li>Signed approvals / on-chain reviewer roles (see the first question).</li>
          <li>Contributors publishing their own forks and owners pulling them — the version graph supports it; the CLI flow assumes proposals are made on the owner’s repository.</li>
          <li>Vector or graph retrieval. Search is keyword-ranked over the current snapshot, scoped by topic and subject, which is enough at namespace scale; the seam is pluggable.</li>
          <li>Payments, subscriptions, marketplaces, DAO governance, reputation — deliberately later.</li>
          <li>A web UI for writing. The explorer is read-only; contributions and reviews go through the CLI or an agent.</li>
        </ul>,
      },
    ],
  },
]

export default function FAQ() {
  return (
    <>
      <Hero kicker="FAQ" title="Honest answers." sub="What is proven, what is protocol, what is a claim, and what is not built yet. If a question is missing, it probably belongs here." />
      <main className="w-full px-5 sm:px-8 lg:px-10">
        {GROUPS.map((g) => (
          <section key={g.title} className="border-t border-line py-10">
            <h2 className="mb-4 text-xl font-semibold tracking-tight">{g.title}</h2>
            <div className="space-y-3">
              {g.items.map((item) => (
                <details key={item.q} className="group rounded-2xl border border-line bg-surface p-5 open:bg-raised/40">
                  <summary className="cursor-pointer list-none text-[15px] font-medium">
                    <span className="mr-2 inline-block text-dim transition-transform group-open:rotate-90">›</span>{item.q}
                  </summary>
                  <div className="mt-3 space-y-3 text-[13.5px] leading-relaxed text-ink/85">{item.a}</div>
                </details>
              ))}
            </div>
          </section>
        ))}
        <Footer />
      </main>
    </>
  )
}
