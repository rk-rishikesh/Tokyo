import Link from 'next/link'
import { Step } from '@/components/demo/Steps'
import { PageHeader } from '@/components/ui'
import { CopyBlock } from '@/components/demo/CopyBlock'
import { Terminal, type Line } from '@/components/demo/Terminal'

export const metadata = { title: 'Demo — MCP in action' }

// Reads of public namespaces go through a Pinata gateway; this deployment's is
// shared so a fresh install can read cancer-research.eth without an account.
const GATEWAY = process.env.PINATA_GATEWAY?.replace(/^https?:\/\//, '').replace(/\/$/, '') || '<your-gateway>.mypinata.cloud'

const INSTALL = `claude mcp add knowledge \\
  -e PINATA_GATEWAY=${GATEWAY} \\
  -- npx -y @knowledge01/mcp`

const PROMPTS = [
  'Pull cancer-research.eth from the knowledge network, then tell me what it says about PARP inhibitors.',
  'Why does it say that? Show me the sources and who reviewed it.',
  'Propose adding to cancer-research.eth: "Niraparib, a PARP inhibitor, is approved as maintenance treatment for recurrent ovarian cancer after response to platinum chemotherapy", sourced to the FDA approval of March 2017.',
]

// Tool calls and results are verbatim (trimmed) from @knowledge01/mcp 0.3.0
// against the live cancer-research.eth; the agent's replies are paraphrased.
const SCRIPT: Line[] = [
  { kind: 'cmd', text: 'claude mcp add knowledge -e PINATA_GATEWAY=… -- npx -y @knowledge01/mcp' },
  { kind: 'cmd', text: 'claude' },
  { kind: 'gap' },
  { kind: 'prompt', text: PROMPTS[0]! },
  { kind: 'tool', text: 'knowledge_pull(namespace: "cancer-research.eth")' },
  { kind: 'out', text: '⎿ fetched 3 commit(s) — cancer-research.eth is at v2. This is a snapshot:\n  the owner may hold unpublished commits.' },
  { kind: 'tool', text: 'knowledge_search(namespace: "cancer-research.eth", query: "PARP inhibitor ovarian")' },
  { kind: 'out', text: '⎿ === KNOWLEDGE: RETRIEVED DATA ===\n  1 result in cancer-research.eth v2 for "PARP inhibitor ovarian"\n  subject: Olaparib · confidence: 0.9\n  contributor: oncology-lab.eth · reviewers: oncology-review.eth\n  sources: document "FDA approval, December 2014"\n  Olaparib, a PARP inhibitor, is approved for BRCA-mutated advanced ovarian cancer' },
  { kind: 'say', text: 'cancer-research.eth (v2) has one claim on PARP inhibitors: olaparib is approved for BRCA-mutated advanced ovarian cancer. It cites the FDA approval of December 2014 and was reviewed by oncology-review.eth.' },
  { kind: 'gap' },
  { kind: 'prompt', text: PROMPTS[1]! },
  { kind: 'tool', text: 'knowledge_sources(namespace: "cancer-research.eth", id: "k_2a6c1a2584f1")' },
  { kind: 'out', text: '⎿ WHY is this known: "Olaparib, a PARP inhibitor, is approved for BRCA-mutated…"\n  sources:     document "FDA approval, December 2014"\n  contributor: oncology-lab.eth\n  reviewers:   oncology-review.eth\n  introduced:  3267186  "Add olaparib approval"  on add-olaparib\n  last change: d3234e7  "#1 Add olaparib approval"  on main' },
  { kind: 'say', text: 'oncology-lab.eth proposed it on a branch; oncology-review.eth approved proposal #1 and it landed on main as d3234e7.' },
  { kind: 'gap' },
  { kind: 'prompt', text: 'Propose adding niraparib as maintenance treatment, sourced to the FDA approval of March 2017.' },
  { kind: 'tool', text: 'knowledge_propose(namespace: "cancer-research.eth", title: "Add niraparib maintenance approval", items: [{ subject: "Niraparib", … }])' },
  { kind: 'out', text: '⎿ [knowledge] opened proposal #2 on cancer-research.eth (proposed)\n  #2 Add niraparib maintenance approval — PROPOSED\n  reader · contrib/muh8l5nx → main · approvals 0\n  automated review: no findings' },
  { kind: 'say', text: 'Proposal #2 is open with no findings. Nothing changes in the namespace until a reviewer approves it.' },
]

export default function McpDemo() {
  return (
    // Wide screens: one screen tall. The steps scroll; the terminal stays whole.
    // 61px is the site header, 5rem the page's own vertical padding.
    <div className="lg:flex lg:h-[calc(100vh-61px-5rem)] lg:flex-col">
      <PageHeader
        title="MCP in action"
        subtitle="Give your own agent the knowledge network. Follow the steps in your terminal; the recording on the right shows what to expect."
      />
      <div className="grid gap-8 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <ol className="space-y-7 lg:min-h-0 lg:overflow-y-auto lg:pb-10 lg:pr-2">
          <Step n={1} title="Before you start">
            <p>Node 22 or newer, and an agent that speaks MCP. The commands below use <a href="https://claude.com/claude-code" className="underline">Claude Code</a>; any MCP client takes the same command and environment.</p>
          </Step>
          <Step n={2} title="Add the server">
            <p>One npm package, run locally by your agent. It holds no wallet, so it can read and propose but never publish on your behalf.</p>
            <CopyBlock text={INSTALL} />
            <p className="text-[13px]">Optional: add <code className="font-mono">-e KNOWLEDGE_AGENT=&lt;your-name.eth&gt;</code> to put your name on what you propose. It is a label, not a memory: nothing is read from or written to it. Without it, proposals are signed <code className="font-mono">reader</code>.</p>
            <p className="text-[13px]">Other clients: command <code className="font-mono">npx</code>, args <code className="font-mono">[&quot;-y&quot;, &quot;@knowledge01/mcp&quot;]</code>, with the same environment.</p>
          </Step>
          <Step n={3} title="Start your agent">
            <CopyBlock text="claude" />
          </Step>
          <Step n={4} title="Try these prompts, in order">
            <p>Each one reads the live <Link href="/k/cancer-research.eth" className="font-mono text-ink underline">cancer-research.eth</Link> namespace on ENS.</p>
            <div className="space-y-2">{PROMPTS.map((p) => <CopyBlock key={p} text={p} prompt />)}</div>
          </Step>
          <Step n={5} title="What just happened">
            <ul className="list-disc space-y-1 pl-5">
              <li>Your agent resolved an ENS name and fetched its versions from IPFS — no account, no API key.</li>
              <li>Every claim came back with its sources, contributor, reviewer and version, so the agent could cite them.</li>
              <li>Your proposal is recorded on your machine. It reaches the namespace only through review: the owner decides.</li>
            </ul>
          </Step>
        </ol>
        <div className="flex flex-col lg:min-h-0">
          <div className="lg:min-h-0 lg:flex-1"><Terminal script={SCRIPT} title="claude — knowledge" fill /></div>
          <p className="mt-2 text-[12.5px] text-dim">Tool calls and results are recorded output from @knowledge01/mcp against the live namespace, trimmed; the agent&rsquo;s replies are paraphrased.</p>
        </div>
      </div>
    </div>
  )
}

