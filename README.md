# Knowledge Network

**Knowledge from everywhere. One network for AI.**

Knowledge infrastructure for AI: connect knowledge from humans, documents, APIs, agents and
applications; give it an ENS identity; version it; review it; make it available to any AI agent.

```
Humans · Documents · APIs · Agents · Applications
                    ↓
        propose → review → commit
                    ↓
     ENS V2 (identity, namespace, ownership, access) → IPFS (immutable versions)
                    ↓
              Agent · App · Human  →  consume → contribute ↺
```

```
cancer-research.eth                   owner · policy · v2 · reviewed
└── trials.cancer-research.eth        its own registry, owner and reviewers

kestrel.eth                           organisation · private
├── treasury.kestrel.eth              policies the Treasury Agent works from
└── watch.kestrel.eth                 what the On-Chain Monitoring Agent treats as unusual
```

Every namespace is an ENS V2 name with its own registry (so it can have children) and its own
resolver. Its `contenthash` points at a refs object on IPFS: policy, branches, proposals and
content-addressed commits. Knowledge is a **claim** — subject, statement, topic, confidence,
sources, contributor, reviewers. Changes are **proposed, reviewed, approved, committed,
published**. Agents consume it through MCP and can always answer *why*.

Live on **Ethereum Sepolia** (ENSv2 beta): [`worldhistory.eth`](https://sepolia.etherscan.io/tx/0xd5bea9155cadad4b11b259e7ee04035e833d99f0f43b536d746b84863eee4da1)
(v2, one landed review) and its child `india.worldhistory.eth`. Record in
[`deployments/sepolia.json`](./deployments/sepolia.json); pinned constants and every
VERIFIED / ASSUMED value in [`CONTRACTS.md`](./CONTRACTS.md).

---

## The idea

Today every AI application keeps its own silo of knowledge. Nobody can say who owns it, where it
lives, who contributed, who reviewed, or which version is authoritative — and nothing else can
build on it.

| question | answer here |
|---|---|
| Who owns this knowledge? | The ENS name's owner. `trials.cancer-research.eth` can have a different owner than `cancer-research.eth`. |
| Where does it live? | `contenthash(name)` → refs → commits on IPFS. Public namespaces in plaintext; private and personal ones encrypted. |
| Who contributed / reviewed it? | On every claim: `contributor`, `reviewers`, `sources`. On every commit: author and, if it came through review, the proposal. |
| Which version is authoritative? | `main` at `vN`. Every version is a content-hashed commit; anyone can verify the chain. |
| Can another agent consume it? | `knowledge_search({ namespace: "cancer-research.eth", query })` over MCP. No account, no key for public namespaces. |

Four roles, separated from applications: **owner**, **contributor**, **reviewer**, **consumer**.
Personal memory (`alice.eth`) is a namespace like any other — same primitive, encrypted.

**Review is a policy, not a tax.** Namespaces have a kind — `public`, `organisation`, `personal` —
that sets the defaults: public and organisational namespaces gate every write behind ≥ 1 approval;
personal ones auto-land (`approvals: 0`) while automated review still runs and queues its findings
for the owner. Unmarked conflicts resolve by policy (`ask` on shared namespaces, `latest` on personal).
Commits are local and instant; publishing is a separate, batched step on an interval or threshold,
and every pull reports the published version and its age.

**Address subjects, attribute writers.** `food.rishikesh.eth`, never `swiggy.rishikesh.eth` — who
wrote a claim and where it came from live on the claim. `init` warns on vendor- or agent-shaped
names. Two sources stating the same claim merge into one claim with higher confidence
(`1 − ∏(1 − cᵢ)`, capped at 0.99); a fact that changed is marked `supersedes` and retires the old
claim without a contradiction.

**Sources are first-class, and named.** Every claim carries its sources with a kind — `human |
document | api | agent | application` — and the product it came from: Claude Code, Cursor, ChatGPT,
Slack, Gmail, Notion, Linear, Wikipedia, Google Drive, government and market data, your own
services. The catalogue lives in `app/console/content/connectors.ts` with an honest status per
entry (working today vs planned) and the claim each would contribute; seven work today.
A source is never a feed: a forecast, a tick or a chat log has no truth condition a second party
would cite. What a connector contributes is the durable statement underneath — the climate norm, the
rebalancing date, the decision the thread reached. A source connects to one or
many namespaces (`knowledge source connect "Treasury policy v3" --kind document`); source-specific
namespaces are a convention, not a protocol rule. Imported claims go through the same review as
everything else.

---

## Quick start

Node 22+, pnpm.

```bash
pnpm install
pnpm build:cli && pnpm build:mcp
alias knowledge="node $PWD/engine/cli/dist/knowledge.mjs"
```

**Owner** — create a namespace, set the policy, seed, publish:

```bash
knowledge init cancer-research.eth --title "Cancer Research" --kind public --register   # ETH registrar + registry + resolver
knowledge policy --reviewer oncology-review.eth --contributors anyone --approvals 1 --readers public
knowledge add "Pembrolizumab is FDA-approved for MSI-H or mismatch-repair-deficient solid tumours, wherever the tumour started" \
  --subject "Pembrolizumab" --topic immunotherapy --type fact --confidence 0.97 \
  --source document:"FDA approval, May 2017"
knowledge commit -m "Seed approvals" && knowledge push                   # → v1, one setContenthash
knowledge init trials.cancer-research.eth --title "Clinical Trials" --register   # child, own registry
```

**Contributor** — propose on a branch; automated review runs:

```bash
knowledge checkout add-parp -b --as oncology-lab.eth
knowledge add "Olaparib, a PARP inhibitor, is approved for BRCA-mutated advanced ovarian cancer" \
  --subject "Olaparib" --topic targeted-therapy --confidence 0.95 --as oncology-lab.eth
knowledge commit -m "Add olaparib" --as oncology-lab.eth
knowledge propose --title "Add olaparib" --as oncology-lab.eth
#  automated review:
#    [missing-sources] "…" cites no sources.     [contradiction] May contradict existing "…" (60% similar).
```

**Reviewer** — read, decide, land:

```bash
knowledge review 1 --as oncology-review.eth                 # findings + diff by claim
knowledge review 1 --approve -m "Matches the label." --as oncology-review.eth
knowledge land 1 --as oncology-review.eth                   # → v2, reviewers stamped on every changed claim
knowledge push
```

**Organisation** — private namespaces the owner's agents work from. The same flow, encrypted, with
a named reviewer and named contributors:

```bash
knowledge init treasury.kestrel.eth --title "Treasury" --kind organisation --private --register
knowledge policy --reviewer cfo.kestrel.eth --contributors treasury-agent.eth --approvals 1 --readers key
knowledge add "Keep at least 18 months of operating runway in USDC" \
  --subject "Runway" --topic policy --confidence 0.99 --source document:"Treasury policy v3"
knowledge add "No single DeFi protocol may hold more than 15% of treasury assets" \
  --subject "Protocol exposure" --topic policy --source document:"Treasury policy v3"
knowledge commit -m "Treasury policy v3" && knowledge push
```

`watch.kestrel.eth` holds what the On-Chain Monitoring Agent (`watch-agent.eth`) treats as unusual —
"The payroll Safe pays contributors on the 1st of each month; outflows on other days are unusual",
"The treasury multisig is 3-of-5; a signer change is always worth an alert".
`portfolio.kestrel.eth` holds what the Portfolio Intelligence Agent (`portfolio-agent.eth`) answers
from — "Kestrel staked 200 ETH through Lido in March 2026". Each agent proposes what it learns;
`cfo.kestrel.eth` reviews.

**Reviewer identity and forks.** `knowledge review <n> --approve --sign` signs the verdict with the
key that owns the reviewer's ENS name; `land` verifies the signer against the name's owner on chain
and shows *verified* vs *claimed*; a namespace can require it (`--signed-approvals true`). A
contributor with no access to the owner's repository proposes from their own clone and exports a
bundle (`propose --export --publish`); the owner ingests it with `pull-proposal <cid>` — every commit
verified by hash — and reviews it like any other.

**Consumer** — a person, an app or an agent:

```bash
knowledge init cancer-research.eth && knowledge pull   # no key, no wallet
knowledge search "pembrolizumab" && knowledge why <id>  # sources · contributor · reviewers · version

claude mcp add knowledge -e KNOWLEDGE_AGENT=<your-name.eth> -- npx -y @knowledge01/mcp
```

```ts
import { Namespace } from '@knowledge01/repo'
const research = Namespace.for('cancer-research.eth')
research.search('MSI-H solid tumours')                      // Hit[] with sources, reviewers, confidence
research.contribute({ title: 'Add olaparib', items: [{ subject: 'Olaparib', claim: '…', topic: 'targeted-therapy', sources: [{ type: 'document', title: 'FDA approval' }] }] })  // → proposal

const alice = Namespace.for('alice.eth', { agent: 'shopping-agent' })   // personal memory
alice.observe({ observation: 'User prefers Nike running shoes', topic: 'shopping', confidence: 0.87 })
```

**Sources and the demo application:**

```bash
knowledge source connect "Treasury policy v3" --kind document --namespace treasury.kestrel.eth
knowledge source connect "watch-agent.eth" --kind agent --namespace watch.kestrel.eth
knowledge source list --namespace tokyo.food.eth
```

**Portability, demonstrated (`knowledge import memory`).** The argument against vendor-held memory
is a slide until someone can leave and keep what was learned. `knowledge import memory <export.json>
--vendor chatgpt --split --owner you.eth` reads an assistant's data export and turns each remembered
fact into a claim in a subject-addressed namespace you own (`food.you.eth`, `code.you.eth`), citing
the export as its source and keeping the original wording as the excerpt. Dry run by default. It
reads several known export shapes and skips what it cannot read rather than guessing — and never
turns conversation transcripts into claims, which would mean inventing statements nobody made.
The same fact from a second assistant merges into one claim with higher confidence. See
`/demo/portability`.

**Every source reads real data. There is no sample or simulated data anywhere.** Three connectors
read files that are already yours — browser history, your editor's project list, your shell history —
and each states the *pattern*, never the log: which products you work on and which tools you use, not
what you typed or when. A connector that would need an OAuth app (Slack, Gmail, Linear, Notion) is
not offered until that app exists, because a Connect button that connects to nothing is a lie.

Two products, one protocol: **`/app`** is the agent a visitor tries — connect sources, watch memory
build, revoke any time. Everything else is the network it writes into, which anything else can build
on. Live from one machine: `tools.recalltest.eth` v8 and `projects.recalltest.eth` v19, including
*"Uses pnpm regularly"* at 98% because the editor manifest and the shell history both said so.

**Chrome history — the connector that started it.** No OAuth, no vendor app: Chrome
keeps history in a local SQLite file that is already yours. `knowledge-connect` reads it and states
the *patterns* — the products you work on, the tools you use — never the browsing. A page visit is not
a claim; visiting an inbox 300 times says nothing true or false about the world. The bar for a
"works on" claim is deliberately high, because a wrong claim in a namespace built for provenance is
worse than a missing one: on a real 90-day history it produced 4 claims, not 13. Live on Sepolia at
`tools.recalltest.eth` (v3) and `projects.recalltest.eth` (v1), read back on a fresh machine with
only the name and a key.

**Connected apps (`@knowledge01/connect`).** A local service your apps post to, so the demo everyone
asks for — "I connect my apps and they write into my memory" — actually runs: `pnpm demo:connect`.
Slack is a real connector (`/knowledge` command or a 📌 reaction; channel traffic is never read) and
Claude Code writes through MCP; Gmail, Linear and Notion are scripted for the demo and labelled as
such everywhere. Every event goes through one path: a human marks a statement → it becomes a claim
in a namespace **you** own (`decisions.acme.eth`, not `slack.acme.eth` — W1) citing the message →
an ordinary commit and version bump. Chatter, questions and acknowledgements are skipped with the
reason recorded. Two apps stating the same thing merge into one claim with both sources and higher
confidence. The service holds **no wallet**: publishing stays `knowledge push`. Live view at
`/connect`.

**Coding-agent wedge (`conventions.<org>.eth`).** This repository's own conventions live at
`conventions.recalltest.eth` (organisation kind, 10 claims, published). [`adapters/`](./adapters)
holds a Claude Code skill and a Cursor rule that make any agent search it before answering "how do
we…" and propose back what it learns; this repository dogfoods them via `.mcp.json` and
`.claude/skills/knowledge/`.

Web: `pnpm dev` → http://localhost:3000 — homepage (the product loop, Why ENS, sources, composition),
`/namespaces` (hierarchy), `/k/<ns>` (Knowledge · Branches · Contributors · History · Reviews · Diff),
`/k/<ns>/item/<id>` ("Where did this come from?"), `/sources`, `/contributions`, `/reviews`,
`/for-agents`, `/developers`, `/use-cases`, `/compare/memory` (memory platforms and personal agents:
*persistent to whom, and for how many versions?*), `/connect` (apps writing live), `/demo/portability`, `/roles/<role>`, `/faq`,
and **`/demo/travel`** — an AI travel
agent that composes `food.rishikesh.eth` + `rishikesh.eth` (private) + `japan.travel.eth` +
`tokyo.food.eth` and shows every claim it
used with its source and version. The agent is scripted (no LLM) so every line is traceable; the
retrieval and provenance are real.

---

## What is where

Two products, one repository. `engine/` is the knowledge network and works with
no demo present; `app/` is the demo built on it. `pnpm check:layering` fails if
that arrow ever points the other way.

```
engine/                 the protocol — published to npm as @knowledge01/*
  core/                 objects (Knowledge, Commit, Refs, Policy, Proposal) · merge · diff · revert
                        why (provenance across merges) · search · observe · review (automated findings)
                        contracts, resolve, roles, crypto — ENSv2 reads, EAC roles, AES-GCM/ECIES
  repo/                 RepoStore (on disk) · Repository (add/commit/branch/merge/revert ·
                        propose/review/land · policy) · Remote (push/pull) · EnsPointer
  storage/              StorageAdapter: Pinata (IPFS), Swarm, in-memory · contenthash codec
  cli/                  `knowledge` — init, add, observe, import wikipedia | memory, propose,
                        pull-proposal, review (--sign), land, findings, policy, source, push, pull
  mcp/                  `knowledge_*` MCP server, 18 tools, one server for many namespaces
  adapters/             Claude Code skill + Cursor rule; conventions seed

app/                    the demo product built on the engine
  connect/              sources that observe real data and write claims:
                        browser history, editor projects, shell history, Claude Code (local)
                        GitHub, Linear, Granola, Google Workspace (OAuth)
                        registry · policy · topics · OAuth + token refresh · chat with MCP tool calls
  console/              Next.js: / · /app (the product) · /namespaces · /k/<ns>/… · /sources
                        /contributions · /reviews · /for-agents · /developers · /roles/<role>
                        /faq · /protocol · /compare · /me/<ns>

scripts/                guards: check-layering · check-packaging · check-config · check-oauth
                        check-abi-usage · check-deployment · check-resolve
deployments/            sepolia.json — live record
docs/ROADMAP.md         what is left, and why it is in that order
```

Every source reads real data. There is no sample or simulated connector
anywhere in `app/connect`: a source either reads something that genuinely
belongs to the person connecting it, or it is not offered.

---

## How it works

### Objects

- **Knowledge** `{id, subject, claim, type, topic, confidence, sources[], contributor, reviewers[], tags, created_at, updated_at?}`.
  A **Source** is `{type, kind?: human|document|api|agent|application, name?, id?, title?, excerpt?}`.
  `id = k_ + sha256(claim, subject, topic)[:12]` — derived from *what is claimed*, not from who
  claimed it, so two contributors stating the same thing collapse onto one object.
- **Commit** `{id, parents[], branch, author, timestamp, message, changes, snapshot, proposal?}`.
  `id = sha256(canonical body)`. Snapshot inline. `proposal` set when landed through review.
- **Refs** `{namespace, head, branches, objects (commit → CID), policy, proposals, sources, title, description, parent, children}` — the only
  thing `contenthash` points at, so reviewers and readers share one view of policy and review state.
- **Policy** `{owner, reviewers[], contributors: 'anyone' | [...], readers: 'public' | 'key', approvals}`.
- **Proposal** `{number, title, author, branch, base, baseCommit, status, reviews[], findings[], mergedCommit?}` with
  status `proposed → under-review → approved → committed | rejected`.

### Lifecycle

1. **Create** — `init` makes the repository and, with `--register`, the ENS name: top-level via the
   ETH registrar (commit → wait → reveal, test USDC), then a UserRegistry + PermissionedResolver per
   namespace via the Verifiable Factory; children register under the parent's registry with `setParent`.
2. **Propose** — contributors commit on their branch; `propose` opens `#n` and runs **automated
   review** against the base: duplicates, contradictions (same topic and subject, similar claim,
   different statement), missing sources, low confidence, removals of reviewed claims, claim edits
   with no new source. Advisory.
3. **Review** — approvals count toward `policy.approvals`; a contributor cannot approve their own
   proposal; a reject closes it.
4. **Commit** — `land` merges three-way by claim id onto the base, records the proposal on the
   commit and stamps the approving reviewers on every changed claim. `main` becomes `vN+1`.
5. **Publish** — `push` pins new objects (plaintext for public, AES-256-GCM for private) and moves
   `contenthash` once.
6. **Consume** — `pull` resolves the name through the Universal Resolver, fetches refs and missing
   commits, verifies every id. Agents do the same through `knowledge_*`.

### Permissions — what is protocol, what is chain

Every repository acting on a namespace enforces the published policy (`can(policy, identity, action)`):
contributors cannot commit to `main`, only reviewers approve or land, only the owner edits the
policy. ENS V2 enforces the narrow, strong part: only the owner's wallet holds `SET_CONTENTHASH` on
the resolver, so only the owner publishes. Granting reviewers on-chain resolver roles is the natural
next step and needs nothing new in the object model.

### Retrieval

Keyword-ranked search over the current snapshot, scoped by topic and subject. A namespace of
thousands of claims fits a context window several times over — which is why the tree is many
namespaces rather than one giant one. The seam is pluggable if a namespace outgrows it.

### Claims are data, not instructions

Every claim returned to a model is fenced (`--- BEGIN KNOWLEDGE --- … --- END KNOWLEDGE ---`),
preceded by a banner naming it as retrieved data, and stamped with id, sources, contributor,
reviewers and confidence. Bodies containing the fence or banner are rewritten to `(literal)`.

---

## Verification

```bash
pnpm test              # 75 core · 23 repo · 14 storage · 7 cli · 15 connect · 5 mcp · 22 foundry
pnpm typecheck
pnpm check:abi && pnpm check:deployment && pnpm resolve:check
```

Live, 15 September 2026: `worldhistory.eth` registered through the documented ETH registrar,
seeded (v1), a proposal opened with automated findings, commented, fixed, approved and landed
(v2), published; `india.worldhistory.eth` registered as a child with its own registry and
resolver and published (v1); a fresh machine with no key and no wallet pulled both, searched, and
read the provenance and review history; the explorer rendered every route from the published refs.
Later the same day: Wikipedia connected as a source and a real import opened proposal #2 on
`worldhistory.eth` (4 claims, each citing the article), published with the refs.
17 September: `conventions.recalltest.eth` registered as an organisation namespace and published
(v1, 10 claims); `food.rishikesh.eth` created subject-addressed with the same claim from two sources
merging to 0.96; W1–W6 of the follow-up PRD shipped with 12 new tests.
22 September: memory-export importer (`import memory`) with 7 tests; exports from three assistants
imported into four subject-addressed namespaces, the same fact from two of them merging to 0.91;
`/compare/memory` extended with a personal-agent column and `/demo/portability` added.

### The Universal Resolver pin (read before touching addresses)

On 15 September 2026 the vanity UR proxy `0xeEeE…EeEe` began resolving through a registry set
(root `0x0F62…`, eth `0x1BD2…`) that is **not** the one in the ENS documentation's Sepolia table
and does not contain names registered through the documented ETHRegistrar. This project's declared
authority is the docs table, so `UNIVERSAL_RESOLVER` is pinned to the documented
`UniversalResolverV2` (`0x4A18…`). Root and `.eth` registries are still discovered from the pinned
UR. `knowledge init --register` refuses to run if the registrar's `ETH_REGISTRY` differs from what
the pinned UR resolves — the failure mode is a paid-for name nobody can see.

---

## Rules kept from the original build

1. Never call an ENSv2 function absent from a vendored ABI (`pnpm check:abi`).
2. Never hand-roll a `contenthash` prefix — `@ensdomains/content-hash` with an allow-list and a round-trip check.
3. Never cache ENSv2 token ids; they change on role changes.
4. All storage goes through `StorageAdapter`.
5. The MCP server never holds a funded wallet.
