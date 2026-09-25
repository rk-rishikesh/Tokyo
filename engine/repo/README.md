# @knowledge01/repo

Versioned knowledge repositories: commits, branches, proposals and review.

Git's model, applied to claims rather than files. A namespace has a history, a
default branch, and a policy that decides who may land what. Everything here is
local and free; nothing touches ENS or IPFS until you push.

```bash
npm i @knowledge01/repo
```

## A namespace, a claim, a commit

```ts
import { Repository } from '@knowledge01/repo'

const repo = Repository.init('conventions.acme.eth', 'you.eth')

repo.add({
  claim: 'Use pnpm, not npm — the workspace is a pnpm monorepo',
  subject: 'Package manager',
  topic: 'conventions',
  type: 'convention',
  confidence: 0.95,
  sources: [{ type: 'human', kind: 'human', name: 'you.eth' }],
})

const commit = repo.commit('add the package manager convention')
repo.version('main')        // 1
repo.headSnapshot('main')   // { k_308417d49ff8: { claim: 'Use pnpm, …', … } }
```

A commit carries the whole snapshot, so any version can be read without
replaying history — which is what lets an agent resolve a namespace at a version
and get exactly what was true then.

## Proposals

A contributor who may not land commits directly proposes instead. What happens
next is the namespace's policy, not a convention:

```ts
const proposal = repo.propose('add the deployment runbook')
// approvals: 0 and no blocking findings → lands immediately
// approvals: 1 → waits for a reviewer

repo.review(proposal.ref, 'approve', 'checked against the runbook')
repo.land(proposal.ref)
```

`exportProposal` and `importProposal` move a proposal between machines as a
bundle, so someone can contribute to a namespace they cannot write to — fork
and pull, without a server in between.

## Identity

`repo.actingAs` overrides who the repository acts as for this process only. It
is never written to disk, because a CLI flag that silently persists is how the
wrong person ends up attributed on a claim.

```ts
repo.actingAs = 'alice.eth'
repo.roles()  // what alice may do here
```

## Publishing

`publishDue()` reports whether local commits should reach ENS yet, according to
the namespace's own cadence — an interval, a pending-commit count, or manual.
Pushing itself lives in the remote layer, so a repository that never publishes
still works completely.

## Related

- [`@knowledge01/core`](../core) — what a claim is, and how two of them merge
- [`@knowledge01/storage`](../storage) — IPFS and contenthash encoding
- [`@knowledge01/cli`](../cli) — the same operations from a terminal

MIT
