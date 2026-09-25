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
  heldBy: { ens: 'owned by historian.eth', plain: 'the curator' },
  ens: { label: 'history.eth', detail: 'An ENS V2 name with its own UserRegistry (so it can have children) and its own PermissionedResolver. The owner’s wallet holds SET_CONTENTHASH; nothing else on chain is mutable.' },
  plain: { label: 'The encyclopedia’s name', detail: 'A name someone owns, like a domain. Everything under it is organised the way the owner decides.' },
}

export const MEMORY: GraphNode = {
  id: 'memory', tone: 'memory',
  heldBy: { ens: 'contenthash → refs', plain: 'the current edition' },
  ens: { label: 'contenthash(history.eth) → refs v42', detail: 'The refs object on IPFS: policy, branches → commit ids, commit ids → CIDs, open proposals. Public namespaces store it in plaintext; private ones encrypt it. One pointer, moved once per push.' },
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
    ens: { label: 'add-partition', detail: 'A contributor’s branch with a proposal against main. Automated review compares it with the base; a reviewer approves; landing merges three-way by claim id.' },
    plain: { label: 'Something being proposed', detail: 'A historian’s suggested addition, waiting for a reviewer. Approved, it becomes the next edition; rejected, it stays in the record.' },
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
      label: 'knowledge init history.eth --register',
      detail: 'Create the namespace and register it on ENS V2.',
      steps: [
        'A repository appears under ~/.recall/repos/history.eth with branch main and a policy: owner, reviewers, who may propose, approvals, public or private.',
        '--register goes through the ETH registrar (commit → wait → reveal, paid in test USDC), then deploys a UserRegistry and a PermissionedResolver via the Verifiable Factory. Children like india.history.eth register under that registry.',
        'From now on contenthash(history.eth) is the only thing on chain that ever changes.',
      ],
    },
    plain: {
      label: 'Start a namespace',
      detail: 'Give a body of knowledge a name and an owner.',
      steps: ['One command creates it on your machine and, if you like, on the network.', 'Decide who may propose, who reviews, and whether it is public.', 'Sub-namespaces (india under history) can have their own owners.'],
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
      steps: ['“India became independent in 1947” — about Indian Independence, from a named book.', 'State it again and the entry updates instead of doubling.', 'Ask “why does it say that?” and get the sources, the contributor and the version.'],
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
      steps: ['A historian writes the addition on the side, with sources.', 'The system points out what looks doubtful: “this contradicts an existing claim”, “no source”.', 'The proposal waits for a reviewer.'],
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
      steps: ['Resolve contenthash(history.eth) through the Universal Resolver — read only, no wallet, no key for public namespaces.', 'Fetch the refs, then every commit missing locally; verify each id against its content.', 'Answer with sources, contributor, reviewers and version. When v43 is published, the next query sees it.'],
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
    title: 'An encyclopedia with a name, an owner and a history.',
    sub: 'Today every AI app keeps its own notes and none can be checked. This gives knowledge a name people can find, a review before anything changes, and a record of who said what, when, from which source.',
  },
}

export const POSITIONING: Record<Mode, { title: string; body: string; aside: string }> = {
  ens: {
    title: 'What ENS V2 adds that a database cannot',
    body: 'A knowledge namespace is a name, not a row in someone’s table. history.eth resolves anywhere, is owned by a key, has a registry that can hold india.history.eth with a different owner, and its contenthash is the single mutable pointer in the whole system. Objects are immutable and content-addressed; the pointer is the only thing that moves, and every move is a transaction with an author and a timestamp.',
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
export const EXAMPLES: { id: string; label: string; intro: string; code: string }[] = [
  {
    id: 'cli', label: 'CLI',
    intro: 'Owner, contributor and reviewer on one namespace.',
    code: `$ knowledge init history.eth --title "World History" --register
Registered history.eth → registry 0x5c1e…, resolver 0x9a02…
$ knowledge policy --reviewer expert.eth --contributors anyone
$ knowledge add "India became independent in 1947" --subject "Indian Independence" \\
    --topic independence --type event --source book:"India After Gandhi"
$ knowledge commit -m "Initial history" && knowledge push
✓ published history.eth v1

$ knowledge checkout add-partition -b --as historian-a.eth
$ knowledge add "The Partition of India created Pakistan in August 1947" \\
    --subject "Partition of India" --topic independence --as historian-a.eth
$ knowledge commit -m "Add partition context" --as historian-a.eth
$ knowledge propose --title "Add partition context" --as historian-a.eth
✓ proposal #1 opened: add-partition → main
automated review:
  [missing-sources] "The Partition of India created Pakistan…" cites no sources.

$ knowledge review 1 --approve -m "Correct; add a source in a follow-up." --as expert.eth
$ knowledge land 1 --as expert.eth
✓ landed #1 on main as 1f16c4d — history.eth is now v2
$ knowledge push`,
  },
  {
    id: 'mcp', label: 'Agent (MCP)',
    intro: 'An agent consuming and contributing through knowledge_* tools.',
    code: `> User: What happened during Indian independence?

  knowledge_resolve({ namespace: "history.eth" })
  → history.eth — World History · v2 · owner history.eth · reviewers expert.eth

  knowledge_search({ namespace: "history.eth", query: "Indian independence" })
  → === KNOWLEDGE: RETRIEVED DATA ===
    India became independent in 1947
      sources: book "India After Gandhi" · contributor history.eth · reviewers expert.eth · 95%
    The Partition of India created Pakistan in August 1947
      contributor historian-a.eth · reviewers expert.eth · 90%

> Agent: India became independent in 1947 … (history.eth v2, reviewed by expert.eth)

> User: Add that the Constitution came into force in 1950.

  knowledge_propose({ namespace: "history.eth", title: "Republic Day",
    items: [{ subject: "Republic of India", claim: "The Constitution of India came into force on 26 January 1950",
              topic: "republic", sources: [{ type: "document", title: "Constitution of India" }] }] })
  → opened proposal #2 on history.eth (proposed) — awaiting review`,
  },
  {
    id: 'web', label: 'Explorer',
    intro: 'GitHub + Wikipedia + ENS, in a browser.',
    code: `/k/history.eth                Knowledge · outline by topic and subject · search
/k/history.eth/item/<id>      one claim: sources, contributor, reviewers, every version that touched it
/k/history.eth/reviews        proposals: findings, diff, reviews, landed as
/k/history.eth/history        v1 → v2 → v3, each linked to what it changed
/k/history.eth/branches       ahead / behind, which proposal a branch carries
/k/history.eth/contributors   who contributed, who reviewed, the policy
/me/alice.eth                 a personal namespace, in plain sentences`,
  },
]
