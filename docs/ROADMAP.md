# Getting to product grade

Two products, sequenced by leverage.

- **`engine/`** — the knowledge network. Becomes npm packages a third party
  could adopt without reading our source.
- **`app/`** — the demo built on it. Becomes something a stranger can sign into
  and use without us being present.

## Constraints

- **Nothing costs money.** OpenRouter is the one exception. Every provider is
  free-tier or free-to-register; storage and hosting stay on free plans. Where a
  paid path exists, the free one is the product and the paid one is a note.
- **No placeholder identity in the product path.** `acme.eth`, `demo.eth`,
  `recalltest.eth` are test fixtures. If one can reach a real user, that is a
  bug, not a default.
- **No table decides what a claim means.** Keyword lists encode assumptions
  about a life. What they cannot see is invisible, and they fail silently.
- **Any user can connect.** Not "any user we set up first".

---

## Done

**Granola never synced.** Two bugs, either of which alone produced the same
symptom — a connection that works the day it is made and then goes quiet.
Access tokens expire within hours and nothing called `refreshAccessToken`, so
the reader got a 401, caught it, and reported nothing; and the reader assumed
JSON when Granola answers with XML-ish markup. `liveToken` now refreshes ahead
of expiry and records why a connection failed.

**Namespace collisions.** A GitHub `rishikesh`, a Google `rishikesh@gmail.com`
and a Linear `Rishikesh` all resolved to one namespace — three users, one
repository, each reading the others' claims.

**The consent screen lied.** It promised 90 days of GitHub history while the
reader used 15. `policy.ts` holds every threshold, the copy is generated from
it, and a test fails if any scope claims a window its source does not use.

**Placeholder identities.** The portability page loaded repositories from a
literal list of one developer's namespaces. `check:config` now fails if a
fixture identity appears in code that runs for a real person, and a
misconfigured deployment fails at boot rather than on a stranger's first click.

**Sources are a registry.** `readSourceNow` was a 70-line dispatch chain wrapped
in one try/catch, so a source that threw was indistinguishable from one with
nothing to say. Adding a source is now one entry plus a reader.

**Topics are defined once.** The list was written out four times with two
different lengths, and the console's display map shared no keys with what the
connectors produce, so every claim was labelled by accident.

**Scheduled passes.** `tickAll` existed and nothing called it. `/api/cron/tick`
runs every six hours on Vercel's free plan. Its first real run found that
`allUsers()` was reading `.grants.json` files as users.

**Confidence means something.** Every claim was 0.85 regardless of evidence, so
the console's "not very sure" badge could never fire. It now follows the
evidence: a counted rule 0.85, a model 0.7, a single observation 0.6.

**What someone builds is measured, not looked up.** `NOISE` was sixty hardcoded
brands encoding one particular life. Depth per page against the person's own
median separates building from using, and on real history the product someone
builds sits at 5.7x while every platform sits near 1.

**UI.** A serif display face against Inter, shared section furniture, and
`/why` — which answers the question the demo produces most by showing every
threshold, what each confidence tier means, and what the agent turned away.

**Engine READMEs.** Five packages were publishable and none could be adopted
without reading our source.

---

## What is left

### Persistence

Repositories, grants, activity, users and tokens are JSON files in `~/.recall`.
`RepoStore` needs an interface behind it with the filesystem as one
implementation and a free Postgres (Supabase, Neon) as another.

### Users own their memory

The host still generates each personal namespace's content key and holds the
publishing key. A hosted visitor's memory is readable by the operator and
publishable only by them — the "persistent for the application, not for you"
critique the comparison page makes, currently true of us. Deriving the content
key from a wallet signature is what earns the word "decentralized".

### Publish the engine

Five packages have READMEs and build correctly. `npm publish` is the remaining
step, once the API stops moving.

### Smaller things

- `TOOLS` in `chrome.ts` is still 8 host patterns mapped to fixed sentences.
  Should be seed data the model extends, not a ceiling.
- `TOPIC_RULES` still classifies by keyword. It falls back to `notes` now rather
  than asserting a decision, but the model would do better.
- `repoview.ts` is 297 lines mixing loading with fifteen selectors.
- The claims list on `/app` shows 24 and then stops, with no way to see more.

---

## P5 — Memory survives the process

Repositories, grants, activity, users and tokens are JSON files in `~/.recall`.

**Steps**

1. A storage interface behind `RepoStore`; filesystem as one implementation.
2. A free Postgres (Supabase, Neon) as the second. Both have free tiers that
   cover a demo.
3. Schedule `tickAll()` — nothing calls it, so hosted claims only update while a
   page is open. A Vercel cron on the free plan runs daily; for anything more
   frequent, the watcher stays client-driven.

**Done when** two instances share one database and a restart loses nothing.

---

## P6 — Users own their memory

The host generates each personal namespace's content key and holds the
publishing key. A hosted visitor's memory is readable by the operator and
publishable only by them — which is the "persistent for the application, not for
you" critique the comparison page makes, currently true of us.

**Steps**

1. Derive the content key from a wallet signature after ENS verification. The
   host stores ciphertext it cannot read.
2. The browser signs `setContenthash`. This is the one place a user spends: gas
   on Sepolia, which is free from faucets. It must be labelled — the current
   "signing costs nothing" copy is accurate only because this step does not
   exist yet.

**Done when** deleting the server does not cost a user their memory.

---

## P7 — The engine ships as packages

Builds already emit NodeNext ESM with declarations, `exports` has a
`development` condition, and `@knowledge01` is free on npm. Publishing is free.

**Steps**

1. A README per package: what it is, the smallest working example, the public
   API. Written for someone who has not read our source.
2. Freeze the surface. Anything exported we do not intend to support moves
   behind a subpath or out of `index.ts`.
3. Publish `@knowledge01/core`, `storage`, `repo`, `cli`, `mcp`.
4. The app depends on published versions, so the boundary is enforced by the
   registry and not only by `check:layering`.

**Done when** `npm i @knowledge01/repo` in an empty directory runs the README
example.

---

## P8 — UI

Waiting on your inspiration. What already helps:

- 63 design tokens in `globals.css`, dark mode handled.
- Source rows render from the manifest, so P2 improves the UI for free.

What needs work regardless:

- `/app` is one 233-line page doing six jobs.
- Empty, loading and error states are inconsistent.
- Nothing shows *why* something was not remembered — the most common question
  the demo produces.
- `oauth.ts` (355 lines, six jobs) and `repoview.ts` (297) want splitting.

---

## Order

P1 and P2 first — one is how a stranger meets the product, the other is what
makes everything after it cheap. P3 with P2, since the manifest is where policy
lives. P4 after P2, because the registry is where a per-source classifier hangs.
P5 before any real deployment. P6 is what earns the word "decentralized". P7
whenever the engine API stops moving. P8 when the inspiration arrives.
