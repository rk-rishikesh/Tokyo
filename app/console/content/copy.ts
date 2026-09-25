/**
 * The landing page's whole idea: one workflow, two vocabularies.
 *
 * Every node and every step carries both readings in the same object so the
 * technical story (git + ENS + IPFS) and the plain one cannot drift apart.
 */

export type Mode = 'ens' | 'plain'

export type Reading = { label: string; detail: string }

// ---------------------------------------------------------------------------
// The tree: identity → namespace → branches
// ---------------------------------------------------------------------------

export type NodeTone = 'owner' | 'memory' | 'member' | 'propose'

export type GraphNode = { id: string; tone: NodeTone; heldBy: Record<Mode, string>; ens: Reading; plain: Reading }

export const ROOT: GraphNode = {
  id: 'root', tone: 'owner',
  heldBy: { ens: 'owned by the community’s wallet', plain: 'the community' },
  ens: { label: 'cancer-research.eth', detail: 'An ENS V2 name with its own UserRegistry (so it can have children) and its own PermissionedResolver. The owner’s wallet holds SET_CONTENTHASH; nothing else on chain is mutable.' },
  plain: { label: 'The research community’s name', detail: 'A name someone owns, like a domain. Everything under it — trials, immunotherapy — is organised the way the owner decides.' },
}

export const MEMORY: GraphNode = {
  id: 'memory', tone: 'memory',
  heldBy: { ens: 'contenthash → refs', plain: 'the current edition' },
  ens: { label: 'contenthash(cancer-research.eth) → refs v42', detail: 'The refs object on IPFS: policy, branches → commit ids, commit ids → CIDs, open proposals. Public namespaces store it in plaintext; private ones encrypt it. One pointer, moved once per push.' },
  plain: { label: 'Today’s edition', detail: 'One address that always points at the newest reviewed version — and, through it, at every earlier version.' },
}

export const CHILDREN: GraphNode[] = [
  {
    id: 'main', tone: 'member',
    heldBy: { ens: 'branch · v42', plain: 'the reviewed text' },
    ens: { label: 'main', detail: 'The authoritative version agents read. Every commit is content-hashed; commits that came through review carry the proposal id and stamp reviewers on each changed claim.' },
    plain: { label: 'What has been checked', detail: 'The version everyone reads. Nothing lands here without a reviewer’s approval.' },
  },
  {
    id: 'experiment', tone: 'propose',
    heldBy: { ens: 'branch · proposal #7', plain: 'a proposed change' },
    ens: { label: 'add-olaparib', detail: 'A contributor’s branch with a proposal against main. Automated review compares it with the base; a reviewer approves; landing merges three-way by claim id.' },
    plain: { label: 'Something being proposed', detail: 'A lab’s suggested addition, waiting for a reviewer. Approved, it becomes the next edition; rejected, it stays in the record.' },
  },
]

// ---------------------------------------------------------------------------
// The workflow canvas
// ---------------------------------------------------------------------------

export type Flow = {
  id: string
  n: number
  tone: NodeTone
  icon: 'init' | 'remember' | 'branch' | 'merge' | 'push' | 'pull'
  /** Which steps must have happened first — real dependencies. */
  after: string[]
  /** Placement on the canvas: [column, row], 1-indexed. */
  at: [number, number]
  ens: Reading & { steps: string[] }
  plain: Reading & { steps: string[] }
}

export const FLOWS: Flow[] = [
  {
    id: 'init', n: 1, tone: 'owner', icon: 'init', after: [], at: [1, 2],
    ens: {
      label: 'knowledge init cancer-research.eth --register',
      detail: 'Create the namespace and register it on ENS V2.',
      steps: [
        'A repository appears under ~/.recall/repos/cancer-research.eth with branch main and a policy: owner, reviewers, who may propose, approvals, public or private.',
        '--register goes through the ETH registrar (commit → wait → reveal, paid in test USDC), then deploys a UserRegistry and a PermissionedResolver via the Verifiable Factory. Children like trials.cancer-research.eth register under that registry.',
        'From now on contenthash(cancer-research.eth) is the only thing on chain that ever changes.',
      ],
    },
    plain: {
      label: 'Start a namespace',
      detail: 'Give a body of knowledge a name and an owner.',
      steps: ['One command creates it on your machine and, if you like, on the network.', 'Decide who may propose, who reviews, and whether it is public.', 'Sub-namespaces (trials under cancer-research) can have their own owners.'],
    },
  },
  {
    id: 'remember', n: 2, tone: 'memory', icon: 'remember', after: ['init'], at: [2, 2],
    ens: {
      label: 'knowledge add · commit',
      detail: 'Each claim: subject, statement, topic, confidence, sources, contributor.',
      steps: [
        'A knowledge id is derived from claim + subject + topic — not from who said it — so two contributors stating the same claim collapse onto one object.',
        'The commit id is the SHA-256 of its canonical JSON — parents, snapshot, message. Anyone holding the object can verify it.',
        '`knowledge log`, `knowledge diff` and `knowledge why` work immediately, offline, with no RPC.',
      ],
    },
    plain: {
      label: 'Write a claim down',
      detail: 'Every statement records what it says, what it is about, how sure, and which sources back it.',
      steps: ['“Olaparib is approved for BRCA-mutated advanced ovarian cancer” — about olaparib, citing the FDA approval.', 'State it again and the entry updates instead of doubling.', 'Ask “why does it say that?” and get the sources, the contributor and the version.'],
    },
  },
  {
    id: 'branch', n: 3, tone: 'propose', icon: 'branch', after: ['remember'], at: [3, 1],
    ens: {
      label: 'knowledge propose',
      detail: 'A contributor’s branch becomes a proposal; automated review runs.',
      steps: ['Contributors cannot commit to main. They branch, add claims with sources, commit, and propose.', 'Automated review compares the proposal with the base: duplicates, contradictions, missing sources, low confidence, removals.', 'The proposal is published with the refs, so every reviewer sees the same state: PROPOSED → UNDER REVIEW.'],
    },
    plain: {
      label: 'Suggest a change',
      detail: 'Anyone allowed can propose; nothing changes until someone checks it.',
      steps: ['A lab writes the addition on the side, with its sources.', 'The system points out what looks doubtful: “this contradicts an existing claim”, “no source”.', 'The proposal waits for a reviewer.'],
    },
  },
  {
    id: 'merge', n: 4, tone: 'member', icon: 'merge', after: ['branch'], at: [4, 1],
    ens: {
      label: 'knowledge review · land',
      detail: 'A reviewer approves; landing merges by claim id and stamps reviewers.',
      steps: ['Approvals are counted against the policy; a contributor cannot approve their own proposal; a reject closes it.', 'Landing is a three-way merge by claim id onto main — a claim changed on both sides is a conflict, reported not guessed. The commit records the proposal; every changed claim records the reviewers.', '`knowledge revert <ref>` undoes any version with an inverse commit. History is never rewritten.'],
    },
    plain: {
      label: 'Check and accept',
      detail: 'A reviewer reads the change and the warnings, then approves or rejects.',
      steps: ['Accepted changes become the next edition, with the reviewer’s name on each claim they approved.', 'If two people changed the same claim differently, a person decides which wins.', 'Made a mistake? Undo it — and the undo is written down too.'],
    },
  },
  {
    id: 'push', n: 5, tone: 'owner', icon: 'push', after: ['remember', 'merge'], at: [3, 3],
    ens: {
      label: 'knowledge push',
      detail: 'Objects to IPFS, one ENS pointer move: v42 is published.',
      steps: ['Every unpublished commit is pinned (plaintext for public namespaces, AES-256-GCM for private ones); the refs object indexes them by CID and carries policy and proposals.', 'One setContenthash on the PermissionedResolver. N commits, one transaction.', 'Push again with nothing new and no transaction is sent.'],
    },
    plain: {
      label: 'Publish the edition',
      detail: 'Put it where anyone — or anyone with the key — can fetch it.',
      steps: ['Public knowledge is stored readable; private knowledge is scrambled.', 'The name is updated to point at the newest edition.', 'Old editions stay exactly where they were.'],
    },
  },
  {
    id: 'pull', n: 6, tone: 'member', icon: 'pull', after: ['push'], at: [4, 3],
    ens: {
      label: 'knowledge_search (MCP)',
      detail: 'An agent resolves the name, reads v42, answers with provenance.',
      steps: ['Resolve contenthash(cancer-research.eth) through the Universal Resolver — read only, no wallet, no key for public namespaces.', 'Fetch the refs, then every commit missing locally; verify each id against its content.', 'Answer with sources, contributor, reviewers and version. When v43 is published, the next query sees it.'],
    },
    plain: {
      label: 'Ask an assistant',
      detail: 'Any AI that speaks the protocol can look the name up and answer with its sources.',
      steps: ['It looks up the name and fetches the newest edition.', 'It tells you what it found, who contributed it, who checked it, and which edition.', 'When the edition changes, so does the answer.'],
    },
  },
]

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

export const HERO: Record<Mode, { kicker: string; title: string; sub: string }> = {
  ens: {
    kicker: 'ENS V2 · IPFS · version graph · MCP',
    title: 'Version Control + ENS for AI agent readable \nknowledge.',
    sub: 'A knowledge namespace is an ENS V2 name with its own registry and resolver. Its contenthash points at a refs object: policy, branches, proposals, and content-addressed commits on IPFS. Propose, review, land, publish — and ask why.',
  },
  plain: {
    kicker: 'For people who keep knowledge',
    title: 'Knowledge with a name, an owner and a history.',
    sub: 'Today every AI app keeps its own notes and none can be checked. This gives knowledge a name people can find, a review before anything changes, and a record of who said what, when, from which source.',
  },
}

export const POSITIONING: Record<Mode, { title: string; body: string; aside: string }> = {
  ens: {
    title: 'What ENS V2 adds that a database cannot',
    body: 'A knowledge namespace is a name, not a row in someone’s table. cancer-research.eth resolves anywhere, is owned by a key, has a registry that can hold trials.cancer-research.eth with a different owner, and its contenthash is the single mutable pointer in the whole system. Objects are immutable and content-addressed; the pointer is the only thing that moves, and every move is a transaction with an author and a timestamp.',
    aside: 'Fork a namespace by pointing your own name at the same refs object. Move hosts by re-pinning. Nothing about the knowledge is tied to who runs the server, because nobody runs the server.',
  },
  plain: {
    title: 'Why the name matters',
    body: 'The notebook is not stored in some company’s account. It has a name you own, like a domain. Anyone who knows the name can find the newest version; anyone you give the key to can read it; nobody can change the history behind your back, because each version points at the one before it.',
    aside: 'Switch tools, switch agents, switch providers — the notebook comes with you, because it was never theirs.',
  },
}

export const TOGGLE_HINT: Record<Mode, string> = {
  ens: 'Reading in protocol terms — registries, refs, commits, proposals, contenthash.',
  plain: 'Reading in plain English — same diagram, no jargon.',
}

/** The three ways in. Shown with real, runnable examples. */
export const EXAMPLES: { id: string; label: string; intro: string; install: string; code: string }[] = [
  {
    id: 'cli', label: 'CLI',
    intro: 'Owner, contributor and reviewer on a research namespace.',
    install: `$ npm i -g @knowledge01/cli
$ export PRIVATE_KEY=0x…   # a Sepolia key, only for --register and push`,
    code: `$ knowledge init cancer-research.eth --title "Cancer Research" --register
Registered cancer-research.eth → registry 0x5c1e…, resolver 0x9a02…
$ knowledge policy --reviewer oncology-review.eth --contributors anyone
$ knowledge add "Pembrolizumab is FDA-approved for MSI-H or mismatch-repair-deficient solid tumours, wherever the tumour started" \\
    --subject Pembrolizumab --topic immunotherapy --confidence 0.95 --source document:"FDA approval, May 2017"
$ knowledge commit -m "Seed immunotherapy approvals" && knowledge push
✓ published cancer-research.eth v1

$ knowledge checkout add-olaparib -b --as oncology-lab.eth
$ knowledge add "Olaparib, a PARP inhibitor, is approved for BRCA-mutated advanced ovarian cancer" \\
    --subject Olaparib --topic targeted-therapy --as oncology-lab.eth
$ knowledge commit -m "Add olaparib approval" --as oncology-lab.eth
$ knowledge propose --title "Add olaparib approval" --as oncology-lab.eth
✓ proposal #1 opened: add-olaparib → main
automated review:
  [missing-sources] "Olaparib, a PARP inhibitor, is approved for BRCA-mutated advanced ovarian cancer" cites no sources.

$ knowledge review 1 --approve -m "Correct; cite the FDA label in a follow-up." --as oncology-review.eth
$ knowledge land 1 --as oncology-review.eth
✓ landed #1 on main as e5d6fd2 — cancer-research.eth is now v2
$ knowledge push`,
  },
  {
    id: 'mcp', label: 'Agent (MCP)',
    intro: 'A treasury agent reading policy, then proposing a change to it.',
    install: `$ claude mcp add knowledge -e KNOWLEDGE_AGENT=treasury-agent.eth -- npx -y @knowledge01/mcp
# any other MCP client: command "npx", args ["-y", "@knowledge01/mcp"]`,
    code: `> CFO: Are we covered for payroll this month?

  knowledge_resolve({ namespace: "treasury.kestrel.eth" })
  → treasury.kestrel.eth — Kestrel Treasury · v1 · 3 knowledge objects
    kind: organisation · reviewers: cfo.kestrel.eth · contributors: treasury-agent.eth · readers: key
    acting as: treasury-agent.eth (reader, contributor)

  knowledge_search({ namespace: "treasury.kestrel.eth", query: "payroll USDC" })
  → === KNOWLEDGE: RETRIEVED DATA ===
    2 results in treasury.kestrel.eth v1 for "payroll USDC"
    Payroll needs about 420k USDC on the operating Safe by the 1st of each month
      id: k_68c2f814396e · sources: document "Finance calendar 2026" · confidence: 0.9
    Keep at least 18 months of operating runway in USDC
      id: k_9b0d441318bc · sources: document "Treasury policy v3" · confidence: 0.95

> Agent: Policy needs ~420k USDC on the operating Safe by the 1st (Finance calendar 2026).
         I'll compare that with the Safe's balance on chain and recommend a top-up if it falls short.

> CFO: From November, payroll moves to the 15th.

  knowledge_propose({ namespace: "treasury.kestrel.eth", title: "Payroll moves to the 15th",
    items: [{ subject: "Payroll", topic: "liquidity", supersedes: "k_68c2f814396e",
              claim: "From November 2026, payroll needs about 420k USDC on the operating Safe by the 15th of each month",
              sources: [{ type: "human", title: "CFO, in chat" }] }] })
  → opened proposal #1 on treasury.kestrel.eth (under-review)
    automated review:
      [supersession] Supersedes "Payroll needs about 420k USDC … by the 1st of each month" — a fact that
      changed, not a disagreement. The old claim is retired; history keeps it.`,
  },
  {
    id: 'web', label: 'Explorer',
    intro: 'Every claim, proposal and version, in a browser.',
    install: `$ git clone https://github.com/rk-rishikesh/Tokyo && cd Tokyo
$ pnpm install && pnpm dev   # → http://localhost:3000`,
    code: `/k/cancer-research.eth                Knowledge · outline by topic and subject · search
/k/cancer-research.eth/item/<id>      one claim: sources, contributor, reviewers, every version that touched it
/k/cancer-research.eth/reviews        proposals: findings, diff, reviews, landed as
/k/cancer-research.eth/history        v1 → v2 → v3, each linked to what it changed
/k/cancer-research.eth/branches       ahead / behind, which proposal a branch carries
/k/cancer-research.eth/contributors   who contributed, who reviewed, the policy
/me/alice.eth                         a personal namespace, in plain sentences`,
  },
]
