# K01 — Knowledge01

**Knowledge your AI can carry, check and share — owned by a name, not by a vendor.**

K01 is a protocol for AI knowledge. A body of knowledge is an ENS name; what it says is a set of
**claims** — each with its sources, contributor, reviewers and confidence — kept as versioned,
content-addressed commits on IPFS. Any agent reads it through MCP, the CLI or a TypeScript SDK, and
can always answer *why does it say that?*

```
Humans · Documents · APIs · Agents · Applications
                    ↓
        propose → review → commit → publish
                    ↓
   ENS v2 name (owner · roles · pointer)  →  IPFS (every version, verified by hash)
                    ↓
      any agent, any vendor  →  read → cite → contribute ↺
```

---

## What K01 is about

Today every assistant keeps its own memory, in its own store. Nobody can say who owns it, where it
lives, who put a fact there, who checked it, or which version is current — and nothing else can build
on it. K01 makes knowledge a thing you hold rather than a feature of an app.

| | What it means here |
|---|---|
| **Ownership** | A namespace is an ENS name. Whoever owns `treasury.eth` owns what it says; `signals.treasury.eth` can have its own owner. |
| **Portability** | The knowledge lives at the name, not in an app. Switch assistants and it comes with you; `knowledge import memory` turns another vendor's export into claims you own. |
| **Provenance** | Every claim carries its sources, who contributed it and who reviewed it. Every version is a commit whose id is its hash. |
| **Review** | Changes are proposed, checked automatically (duplicates, contradictions, missing sources), approved and landed. How many approvals a namespace needs is its own policy. |
| **Privacy** | Public namespaces are plain text. Private ones are encrypted; access is a key sealed to a reader's own public key — granted, bought, or revoked by re-keying. |
| **Composition** | One agent reads many namespaces — a public one, a team's, your own — and cites each. No data is copied into the agent. |
| **An economy between agents** | Agents buy each other's work, not your memories: a namespace can sell read access over x402, and the buyer reads with its own key. |

Four roles, separate from any application: **owner**, **reviewer**, **contributor**, **reader**.
Personal memory is a namespace like any other — same primitive, encrypted, reviewed by you.

---

## Why ENS

K01 needed a name that is owned, hierarchical, resolvable by anyone and enforceable on chain. ENS v2 is
all four.

- **A name is an owner.** Ownership of the knowledge is ownership of the name — transferable, and
  checkable by anyone without asking us.
- **Hierarchy is real.** Every namespace gets its own registry, so `trials.cancer-research.eth` or
  `signals.treasury.eth` can exist under a parent with a different owner and policy.
- **One pointer.** The name's `contenthash` points at the current version on IPFS. Publishing is one
  transaction; reading needs no server, no account and no API of ours.
- **Roles on chain.** Each namespace has its own PermissionedResolver. The owner holds the right to
  publish; a **reviewer** is granted `ROLE_SET_CONTENTHASH` on that name alone, so what they land they
  can publish; a named **contributor** is granted `ROLE_SET_DATA` on one key,
  `knowledge.proposal.<name>`, to point the owner at a proposal and write nothing else.
  `knowledge roles` reads all of it back from the chain.
- **Records for access.** The access manifest — offers and sealed grants — is a text record
  (`knowledge.access`) on the same name, so a buyer finds the price by resolving the name.
- **Everyone resolves it.** Through the Universal Resolver, the same name answers in our explorer, in
  the ENS explorer and in any app.

Live on **Ethereum Sepolia, ENS v2** — the deployment of 15 September 2026 that ENS's own apps read.
Every namespace here can be seen at `https://explorer.ens.dev/<name>`. ENS resets Sepolia from time to
time; when it does, `scripts/migrate-namespaces.ts` registers each name again and copies its records
across ([`CONTRACTS.md`](./CONTRACTS.md) §13).

---

## The demo apps

### Portfolio Intelligence — two agents, a shared memory, a paid tier

The main demo, at `/demo/onchain`. It shows agents building on each other's knowledge instead of each
starting from zero.

- **Agent A — Market Scout** watches Base and writes what it sees into **`treasury.eth`** (public):
  token prices and their 24-hour moves, yields on Base, what large wallets hold, benchmarks, and a
  treasury playbook. Its fresher work — each watched wallet's transfers over the last seven days and the
  net whale flow — goes into **`signals.treasury.eth`**, encrypted and sold at $0.01 a week over x402.
- **Agent B — Portfolio Intelligence** answers questions about holdings, transactions, yield and
  history. It inherits `treasury.eth`, reads your own memory if you bring one (`personal.eth` shows the
  shape: which wallets are yours, which to track, which coins you watch, how much risk you take), reads
  your wallets live, and answers as a short report with every figure cited.
- **Buying, when it's worth it.** When a question needs the seven-day flows and Agent B holds no grant,
  the model decides whether to pay. It pays over x402 (USDC on Base Sepolia); payment settles first,
  then the namespace key is sealed to Agent B's own key and the grant is published on ENS. From then on
  it reads the paid tier with its own key until the week ends. The chat shows every read and payment as
  it happened.

**How MultiBaas is used.** Every wallet balance in the demo is read on **Base mainnet through
MultiBaas**, so there is no RPC node to run or index to maintain:

- ETH and ERC-20 balances for your wallets and the watched whale wallets, by calling `balanceOf`
  through MultiBaas's built-in ERC-20 interface — the same reads Agent A turns into claims.
- One MultiBaas deployment is bound to Base; every read is cached, since the free plan allows 30,000
  calls a month, and the dashboard reads the snapshot in `treasury.eth` rather than calling live on
  every page view.
- Around it: **Blockscout** for transfer history and **DefiLlama** for prices and pool yields.

### The others

- **`/demo/mcp`** — give your own agent the network: one `claude mcp add`, then read
  `cancer-research.eth`, ask why it says something, and propose a change for review.
- **`/app`** — personal memory: connect your own sources, watch claims appear in a namespace you own,
  and ask it questions; anything that would change another app waits for your approval.
- **`conventions.acme.eth`** — a team's coding conventions every coding agent reads, with a named
  contributor (`acme-dev.eth`) that proposes through ENS and an owner who lands it.

---

## Compared with Supermemory and Mem0

**Supermemory** and **Mem0** are memory layers for AI apps: an API that stores what an app learns about
a user and retrieves it later — Supermemory as a hosted service, Mem0 open source or managed. Both keep
memory inside one app's or one provider's store. K01 is the layer under that: memory addressed by a
name you own, versioned and reviewed, readable by any agent from any vendor, and shareable or sellable
between agents.

---

## Quick start

Node 22+, pnpm.

```bash
pnpm install && pnpm build:cli && pnpm build:mcp
alias knowledge="node $PWD/engine/cli/dist/knowledge.mjs"
```

**Read** — no key, no wallet:

```bash
knowledge init cancer-research.eth && knowledge pull --namespace cancer-research.eth
knowledge search "PARP inhibitor" --namespace cancer-research.eth
claude mcp add knowledge -e PINATA_GATEWAY=<gateway>.mypinata.cloud -- npx -y @knowledge01/mcp
```

**Own** — register, set a policy, seed, publish:

```bash
knowledge init research.eth --title "Research" --kind public --register      # ENS name, registry, resolver
knowledge policy --reviewer reviewer.eth --contributors anyone --approvals 1  # also grants roles on ENS
knowledge add "…" --subject "…" --topic "…" --source document:"…"
knowledge commit -m "Seed" && knowledge push                                  # → v1, one setContenthash
```

**Contribute and review:**

```bash
knowledge checkout my-change -b --as contributor.eth
knowledge add "…" --as contributor.eth && knowledge commit -m "…" --as contributor.eth
knowledge propose --title "…" --export --publish yes --as contributor.eth     # pointer on ENS when granted
knowledge pull-proposal --from contributor.eth                                # the owner, from ENS
knowledge review 1 --approve && knowledge land 1 && knowledge push
knowledge roles                                                               # who may publish or propose
```

**SDK:**

```ts
import { Namespace } from '@knowledge01/repo'
const research = Namespace.for('cancer-research.eth')
research.search('MSI-H solid tumours')   // hits with sources, reviewers, confidence
```

Web: `pnpm dev` → http://localhost:3000.

---

## What is where

`engine/` is the protocol and works with no demo present; `app/` is built on it. `pnpm check:layering`
fails if that arrow ever points the other way.

```
engine/                the protocol — on npm as @knowledge01/*
  core/                claims, commits, refs, policy, proposals · merge · diff · why · search
                       automated review · ENS v2 reads and roles · encryption (AES-GCM, ECIES)
  repo/                repositories on disk · propose/review/land · push/pull · access grants · reader
  storage/             IPFS (Pinata), Swarm, in-memory · contenthash codec
  cli/                 `knowledge` — init, add, propose, review, land, policy, roles, push, pull, offer, access
  mcp/                 `knowledge_*` — 19 tools, one server for many namespaces
  adapters/            Claude Code skill + Cursor rule for a team's conventions namespace
agents/agent-b/        an independent reader: a key, its grants, the network — nothing of the app's
app/
  connect/             sources that read real data and write claims (browser, editor, shell, GitHub, …)
  console/             Next.js: the explorer (/namespaces, /k/<ns>), the demos, /app, docs pages
scripts/               migrate-namespaces · retire-old-deployment · check-abi · check-deployment · …
CONTRACTS.md           every pinned address and constant, and how each was verified
```

---

## How it works, briefly

- **Objects.** A claim's id is the hash of *what is claimed*, so two contributors stating the same thing
  meet on one claim (its confidence rises). A commit's id is the hash of its body. The refs object —
  branches, policy, proposals — is the only thing `contenthash` points at.
- **Lifecycle.** Create → propose (automated review) → review → land (reviewers stamped on every changed
  claim) → publish (pin, then move `contenthash` once) → read (resolve, fetch, verify every id).
- **Enforcement.** Every repository enforces the published policy. ENS enforces the strong part: who can
  move the pointer, and who can write a proposal key.
- **Claims are data, not instructions.** Everything returned to a model is fenced, labelled as retrieved
  data and stamped with its provenance.

## Verification

```bash
pnpm test        # 86 core · 25 repo · 14 storage · 7 cli · 5 mcp · 112 connect
pnpm typecheck
pnpm check:abi && pnpm check:deployment && pnpm resolve:check
```

Rules kept since the first build: never call an ENS v2 function absent from a vendored ABI; never
hand-roll a `contenthash`; never cache ENS token ids; all storage through `StorageAdapter`; the MCP
server never holds a funded wallet.

---

## In short

K01 treats knowledge the way the web treats pages: addressed by a name, owned by whoever holds the name,
readable by anyone allowed to, and linkable across owners. ENS gives it identity, hierarchy and
enforceable roles; IPFS gives it immutable versions; review gives it trust; x402 lets agents pay each
other for work. The result is memory that outlives the app that wrote it — and that the next agent, from
any vendor, can build on.
