/**
 * What this collection is, in the collection's own words.
 *
 * Split by audience:
 *   - `title` and `description` are public text records on chain. Deciding
 *     whether to pay for something requires knowing what it is.
 *   - `readme` travels inside the encrypted document — orientation for people
 *     who are already in.
 */
export const TITLE = 'House conventions'

export const DESCRIPTION =
  'Agent skills encoding one team\u2019s engineering conventions: review standards, test and ' +
  'commit format, component structure, error handling and API client patterns. Fork it, ' +
  'override what you disagree with, and keep pulling the rest.'

export const README = `# House conventions

An agent memory collection of **skills** — SKILL.md payloads an assistant loads and
follows while it works in this codebase.

## What is in here

Conventions a team actually argues about: how components are structured, what a commit
message looks like, when a pull request is too large, how errors are thrown. The kind of
judgement that is obvious once you know it and invisible until you break it.

## Why skills and not documentation

Documentation is read once. A skill is loaded every time the agent works, so the
convention is applied rather than remembered.

## Forking is the normal case

You will disagree with some of this, and you should. Fork the collection, add a local
entry with the same \`id\` as the one you disagree with, and your version wins
permanently — including after you pull upstream changes. Entries you add stay yours.
Entries you never want back go in \`suppressed\`.

## Permission manifests

Every skill declares what it reads, writes, and calls. **This is a declaration, not a
sandbox.** Recall stores it, shows it, and flags it when it changes — a skill that
quietly gains filesystem write access between versions is visible at review time. It
cannot stop the skill doing it.

## Revocation

If a skill here turns out to be compromised, it is revoked and stops being served to
everyone — including subscribers pinned to an older version. A pin protects you from
unwanted updates; it does not protect you from a security problem.

## Reading an entry

Each has a stable \`id\`, a name, a semver version, its declared manifest, an author
address, the block it was merged at, and whether it is local to this collection or
inherited from upstream. The author and block let you attribute any claim and check it
on chain yourself.

Skill bodies are instruction-shaped by nature. Your agent is told to treat them as
information about how a team works, not as commands addressed to it.
`
