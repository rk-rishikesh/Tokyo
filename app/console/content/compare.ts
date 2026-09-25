/**
 * The GitHub comparison. GitHub is the honest analogue — this borrows its
 * mental model on purpose — so the rows have to be fair. Several are ones
 * GitHub wins outright, and the page says so. No outbound links.
 */
import type { Mode } from './copy'

export type Row = { question: string; github: string; memory: Record<Mode, string>; edge: 'memory' | 'github' | 'even' }

export const ROWS: Row[] = [
  {
    question: 'What is the unit of change?',
    github: 'Lines in files. A diff tells you which text moved; it says nothing about what the text means.',
    memory: {
      ens: 'A claim: subject, statement, topic, confidence, sources, contributor, reviewers. Diffs are by claim id and field, so “sources +1” or “confidence 0.6 → 0.9” is a change, not a rewrite of a line.',
      plain: 'A single statement about the world. A change says “this claim gained a source” or “this date was corrected”, not “line 42 changed”.',
    },
    edge: 'memory',
  },
  {
    question: 'How does review handle disagreement?',
    github: 'Textual three-way merge plus human review. Two contradictory facts on different lines never conflict; a reviewer has to notice.',
    memory: {
      ens: 'Automated review compares a proposal with the base by topic and subject: duplicates, contradictions, missing sources, low confidence, removals of reviewed claims. Merge is three-way by claim id.',
      plain: 'Before anyone reads a proposal, the system points at what contradicts what is already known and what has no source. The reviewer decides.',
    },
    edge: 'memory',
  },
  {
    question: 'Can you ask why something is there?',
    github: 'git blame gives you the author and the commit. Whether the line is *true*, who checked it, and on what evidence is not recorded.',
    memory: {
      ens: '`knowledge why` returns sources, contributor, reviewers, confidence, the version that introduced the claim and every revision since — across merges.',
      plain: '“Why does it say 1947?” — “Two books, added by historian-a.eth in v41, approved by expert.eth.”',
    },
    edge: 'memory',
  },
  {
    question: 'Who owns the name, and can it have children?',
    github: 'github.com/history is an account on one company’s servers; “india” would be a folder inside it, with the same permissions.',
    memory: {
      ens: 'history.eth is an ENS V2 name with its own registry. india.history.eth is registered under it with its own owner, policy and reviewers. The contenthash of each is its only pointer.',
      plain: 'The name belongs to its owner the way a domain does — and the owner can hand out sub-names with their own owners. Move hosts, switch tools: the names still work and the history still verifies.',
    },
    edge: 'memory',
  },
  {
    question: 'Who are the readers and writers?',
    github: 'Humans, through a review UI designed for people. Machines read via an API someone must integrate.',
    memory: {
      ens: 'Agents are first-class: knowledge_search, knowledge_sources, knowledge_propose over MCP, with every claim fenced and attributed. Humans use the CLI and the explorer on the same repository.',
      plain: 'An assistant can look a name up, answer with sources, and even propose an addition — which a person then reviews.',
    },
    edge: 'memory',
  },
  {
    question: 'Who can read it?',
    github: 'Public, or private to accounts the owner invites. Enforced by GitHub.',
    memory: {
      ens: 'Public namespaces are plaintext on IPFS — that is the point of history.eth. Private and personal ones are AES-256-GCM encrypted; readers hold the key.',
      plain: 'Public knowledge is readable by anyone. Private knowledge is scrambled; only people with the key can open it.',
    },
    edge: 'even',
  },
  {
    question: 'Review tooling, code search, CI, issues, discussions?',
    github: 'Fifteen years of it. Nothing here comes close.',
    memory: { ens: 'Log, diff, why, proposals with automated findings, and an explorer. That is the surface. Deliberately.', plain: 'A clear history, a review queue and a good “why”. Not a workplace.' },
    edge: 'github',
  },
  {
    question: 'Scale?',
    github: 'Repositories with millions of commits and files.',
    memory: {
      ens: 'Snapshots are inline per commit. Fine for thousands of claims per namespace — which is why the tree is many namespaces, not one giant one.',
      plain: 'Built for an encyclopedia split into named volumes, not for the Linux kernel.',
    },
    edge: 'github',
  },
]

export const THESIS: Record<Mode, { title: string; body: string[] }> = {
  ens: {
    title: 'Is this just GitHub with an ENS remote?',
    body: [
      'The contribution model is deliberately GitHub’s: branches, proposals, reviews, merges. Developers already trust it, and agents can be taught it in a sentence.',
      'What differs is the object model, the review and the remote. The object is a claim with sources, confidence and reviewers, not a file, so diff and review operate on facts. Review is assisted by an engine that knows what “contradicts” means. The remote is a hierarchical ENS name whose single pointer moves once per publish, not an account on a server.',
    ],
  },
  plain: {
    title: 'How is this different from GitHub — or Wikipedia?',
    body: [
      'GitHub keeps a reviewed history of code. Wikipedia keeps a reviewed history of claims, on one company’s servers, for humans. This keeps a reviewed history of claims at names their owners control, for humans *and* agents.',
      'The difference is what gets tracked — statements with sources, confidence and reviewers, not lines of text — and where it lives: at a name you own, not in someone’s account.',
    ],
  },
}

export const VERDICT: Record<Mode, { use: string; instead: string }> = {
  ens: {
    use: 'You keep a body of knowledge people and agents should be able to cite — a research field, a company’s facts, a community’s history, a person’s preferences — and you need ownership, review and provenance that survive switching hosts or models.',
    instead: 'You are versioning code, want reviews, CI and issues, or need a history of millions of objects.',
  },
  plain: {
    use: 'You want knowledge — shared or personal — that AI assistants can look up, cite, and propose changes to, with a record of who said what.',
    instead: 'You are working on software with other people. That is what GitHub is for.',
  },
}

export const TEASER: Record<Mode, { title: string; body: string }> = {
  ens: { title: 'GitHub with an ENS remote?', body: 'Almost. The unit is a claim, review knows what a contradiction is, and the remote is a hierarchical name you own. Here is the honest row-by-row.' },
  plain: { title: 'Isn’t this just GitHub, or Wikipedia?', body: 'Same idea — proposals, review, history — for knowledge that people and AI agents both use. The full comparison, including where GitHub wins.' },
}
