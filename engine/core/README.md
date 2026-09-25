# @k01/core

Knowledge objects, merge rules, review and roles for an ENS-native knowledge
network.

A **claim** is a statement someone made about a subject, with the sources that
support it, the person who contributed it, and the reviewers who have approved
it. This package defines what a claim is and how two of them combine. It has no
storage, no network and no opinion about where claims live.

```bash
npm i @k01/core
```

## Claims merge; they do not overwrite

Two people stating the same thing independently is evidence, not a conflict. So
a merge keeps both sources and raises confidence rather than picking a winner.

```ts
import { combineConfidence, mergeClaim, newKnowledge } from '@k01/core'

const fromAlice = newKnowledge({
  claim: 'Uses pnpm',
  subject: 'Package manager',
  topic: 'conventions',
  contributor: 'alice.eth',
  confidence: 0.8,
  sources: [{ type: 'human', kind: 'human', name: 'Alice' }],
})

const fromReadme = newKnowledge({
  claim: 'Uses pnpm',
  subject: 'Package manager',
  topic: 'conventions',
  contributor: 'bob.eth',
  confidence: 0.8,
  sources: [{ type: 'document', kind: 'document', name: 'README' }],
})

const { merged, newSources } = mergeClaim(fromAlice, fromReadme)
merged.confidence // 0.96
merged.sources    // [Alice, README]
newSources        // 1
```

Confidence combines as `1 − ∏(1 − cᵢ)`, capped at 0.99. Two independent sources
at 80% give 96%; nothing ever reaches certainty.

```ts
combineConfidence([0.8, 0.8]) // 0.96
```

Re-stating something already known is **not** a change. A claim whose sources,
confidence and tags all already exist returns the original untouched, so an
agent on a timer does not commit an empty version on every pass.

## Identity

A claim's id is derived from its content — the normalised claim text, subject
and topic — so the same statement from two places is the same claim without
anyone coordinating.

```ts
newKnowledge({ claim: 'Uses pnpm', subject: 'Package manager', topic: 'conventions', contributor: 'a.eth' }).id
// k_308417d49ff8 — the same id for the same statement, from anywhere
```

## Review

`reviewChanges` reads a proposed change and returns what a reviewer should know
before landing it: duplicates, contradictions, supersessions, claims with no
sources, low confidence, unsupported edits and removals. Some findings block.

```ts
import { blockingFindings, reviewChanges } from '@k01/core'

const findings = reviewChanges(before, after)
if (blockingFindings(findings).length) {
  // a reviewer has to look at this
}
```

The point is that a namespace can be contributed to by people who do not trust
each other, because what lands is decided by policy rather than by whoever
wrote last.

## Roles

`public` | `organisation` | `personal` namespaces carry different defaults —
how many approvals a proposal needs, how unmarked conflicts resolve, when local
commits publish. Personal namespaces auto-land, because asking yourself for
approval is theatre.

```ts
import { normalisePolicy, POLICY_DEFAULTS, rolesOf } from '@k01/core'

rolesOf(policy, 'alice.eth') // ['contributor', 'reviewer']
```

## Also here

- `resolve` — reading ENS through the documented UniversalResolverV2
- `crypto` — AES-256-GCM content keys for private namespaces
- `contracts` — vendored ENSv2 ABIs

## Related

- [`@k01/repo`](../repo) — commits, branches and the review workflow
- [`@k01/storage`](../storage) — IPFS and contenthash encoding
- [`@k01/mcp`](../mcp) — agent access over the Model Context Protocol

MIT
