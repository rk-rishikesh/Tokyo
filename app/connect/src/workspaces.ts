/**
 * Sources a person can connect. Every one reads real data belonging to them.
 *
 * There is no sample or simulated data in this package. A source either reads
 * something that genuinely belongs to the person connecting it, or it is not
 * offered — a Connect button that connects to nothing is a lie.
 *
 * Two kinds, and the distinction matters more than it looks. `local` sources
 * read files on the machine the server runs on: right for someone running this
 * on their own laptop, wrong for every visitor to a hosted site, who would be
 * connecting to the *server's* browser history rather than their own. `oauth`
 * sources belong to whoever signed in, so anyone can connect them from anywhere.
 * `workspacesFor` picks the correct set; nothing else should filter this list.
 */
import type { SourceKind } from '@knowledge01/core'
import { windowPhrase } from './policy.js'

export type Scope = 'read:wallet' | 'read:history' | 'read:workspaces' | 'read:commands' | 'read:repos' | 'read:sessions' | 'read:calendar' | 'read:mail-metadata' | 'read:issues' | 'read:meetings' | 'read:orders'

export type WorkspaceDef = {
  id: string
  name: string
  kind: SourceKind
  glyph: string
  /**
   * How this source is reached.
   *
   * `local` reads files on the machine the server runs on, so it is only
   * offered when that machine belongs to the person looking at the page. On a
   * hosted site those sources are hidden rather than disabled — a Connect
   * button that would read the *server's* browser history is not a feature.
   *
   * `oauth` sources belong to whoever signed in, so anyone can connect them.
   */
  access: 'local' | 'oauth' | 'wallet'
  /** For oauth sources, which provider's token it needs. */
  provider?: 'github' | 'google' | 'linear' | 'granola'
  /**
   * Why this source cannot be offered to a visitor, when that is not obvious.
   *
   * Claude Code is the honest case: there is no OAuth API for it and no server
   * to ask, because the data exists only as files on the machine it ran on. Not
   * an omission to fix later — saying so is better than a button that cannot work.
   */
  localOnlyBecause?: string
  /** What is read, in the person's words. */
  scopes: { id: Scope; label: string; detail: string }[]
  /** What it will never do. The boundary is the product. */
  never: string[]
  /** The actual file or directory read, shown before granting. */
  account: string
  /** One line for the source list, in the person's words. */
  summary: string
}

export const WORKSPACES: WorkspaceDef[] = [
  {
    access: 'local', id: 'chrome', name: 'Browser history', kind: 'application', glyph: '🌐',
    account: '~/Library/Application Support/Google/Chrome/Default/History',
    summary: 'Which sites you use, and how often.',
    localOnlyBecause: 'Browser history lives in a file on your own computer. A website cannot read it, and this one does not try.',
    scopes: [{ id: 'read:history', label: 'Which sites you use, and how often', detail: `Totals per site${windowPhrase('chrome')} — never individual pages, never when you visited them.` }],
    never: ['Log what you browse', 'Read page contents', 'Read cookies, passwords or form data', 'Send anything anywhere'],
  },
  {
    access: 'local', id: 'editor', name: 'Editor projects', kind: 'application', glyph: '📝',
    account: '~/Library/Application Support/Code/User/globalStorage/storage.json',
    summary: 'Which projects you have open, and what they are built with.',
    scopes: [{ id: 'read:workspaces', label: 'Which projects you have open', detail: 'Folder names your editor remembers, and the stack each project declares in its manifest.' }],
    never: ['Read your source code', 'Read file contents beyond package manifests', 'Send anything anywhere'],
  },
  {
    access: 'oauth', provider: 'github', id: 'github', name: 'GitHub', kind: 'application', glyph: '🐙',
    account: 'your GitHub account',
    summary: 'Which repositories you contribute to, and what you write them in.',
    scopes: [{ id: 'read:repos', label: 'Which repositories you work in', detail: `Repository names, languages and how often you contributed${windowPhrase('github')}. Private repositories count toward your language, and are never named.` }],
    never: ['Read your code', 'Name a private repository', 'Read issues, pull request bodies or comments', 'Write anything to GitHub'],
  },
  {
    access: 'wallet', id: 'ethereum', name: 'Wallet on Base', kind: 'application', glyph: '◆',
    account: 'the wallet you signed in with, on Base',
    summary: 'What you hold on Base, and which protocols you use.',
    scopes: [{ id: 'read:wallet', label: 'What you hold and use on Base', detail: `Which assets the wallet holds on Base (ETH and the tokens you hold most of), read through MultiBaas, and which named contracts it calls repeatedly${windowPhrase('ethereum')}, from Base Blockscout. Never an amount.` }],
    never: ['Record a balance or an amount', 'Name who you sent to or received from', 'Read unpriced or spam tokens', 'Sign or send a transaction'],
  },
  {
    access: 'oauth', provider: 'linear', id: 'linear', name: 'Linear', kind: 'application', glyph: '📐',
    account: 'your Linear workspace',
    summary: 'Which teams and projects you are assigned work in.',
    scopes: [{ id: 'read:issues', label: 'Which teams and projects you work in', detail: 'Team and project names, and how many issues are assigned to you. Never an issue title, description or comment.' }],
    never: ['Read issue titles or descriptions', 'Read comments', 'Read other people\u2019s issues', 'Write anything to Linear'],
  },
  {
    access: 'oauth', provider: 'granola', id: 'granola', name: 'Granola', kind: 'application', glyph: '🌀',
    account: 'your Granola account',
    summary: 'Who you meet with, and which meetings recur.',
    scopes: [{ id: 'read:meetings', label: 'Who you meet with', detail: 'Names of people on your meetings, and titles that recur. Never the notes, the summary or the transcript.' }],
    never: ['Read your meeting notes', 'Read an AI summary', 'Read a transcript', 'Read who attended', 'Write anything to Granola'],
  },
  {
    access: 'oauth', provider: 'google', id: 'takeout', name: 'Orders & watching', kind: 'application', glyph: '📦',
    account: 'your Google account',
    summary: 'What you order and what you watch, through Google Takeout.',
    scopes: [{
      id: 'read:orders',
      label: 'Which places you order from, and which channels you follow',
      detail: 'Merchants you order from three times or more, and YouTube channels you return to. Never an individual order, never what you watched on a given night.',
    }],
    never: ['Read an individual order or receipt', 'Read your search history', 'Read your browsing', 'Read anything you have not granted'],
  },
  {
    access: 'local', id: 'claude-code', name: 'Claude Code', kind: 'agent', glyph: '🤖',
    account: '~/.claude/projects',
    summary: 'Which projects you bring an agent to.',
    localOnlyBecause: 'Claude Code keeps its sessions as files on the machine it runs on. There is no API to sign into, so this source only works where those files are.',
    scopes: [{ id: 'read:sessions', label: 'Which projects you use an agent on', detail: 'Folder names and how many sessions each has. The session files themselves are never opened.' }],
    never: ['Read your prompts', 'Read anything an agent replied', 'Open a session file at all', 'Send anything anywhere'],
  },
  {
    // One row, because it is one consent screen: Google asks for Calendar and
    // Gmail together, and two buttons that both redirect to the same dialog
    // would misrepresent what the person is approving.
    access: 'oauth', provider: 'google', id: 'google', name: 'Google Workspace', kind: 'application', glyph: '🅖',
    account: 'your Google account',
    summary: 'Which meetings recur, and which services mail you.',
    scopes: [
      { id: 'read:calendar', label: 'Which meetings recur', detail: `Titles of meetings that happen at least four times${windowPhrase('google-calendar')}, and how many people attend. Never a one-off, never who.` },
      { id: 'read:mail-metadata', label: 'Which services mail you', detail: `Sender domains only, counted${windowPhrase('gmail')}. Personal addresses are dropped entirely.` },
    ],
    never: ['Read any message body', 'Read subject lines', 'Read one-off calendar events', 'Read attendee names or email addresses', 'Send mail or write to your calendar'],
  },
  {
    access: 'local', id: 'shell', name: 'Shell history', kind: 'application', glyph: '⌨️',
    account: '~/.zsh_history',
    summary: 'Which commands you run.',
    scopes: [{ id: 'read:commands', label: 'Which commands you run', detail: 'Command names only, counted — pnpm, git, docker. Never the arguments.' }],
    never: ['Read command arguments', 'Read paths, hostnames or secrets', 'Send anything anywhere'],
  },
]

export const workspace = (id: string): WorkspaceDef | undefined => WORKSPACES.find((w) => w.id === id)

/**
 * The sources to offer in this context.
 *
 * Hosted deployments show only what a visitor can genuinely connect. Serving a
 * "Browser history" button from a server would read the server's own browsing,
 * which is both useless to the visitor and a leak of whoever runs the box.
 */
export const workspacesFor = (opts: { hosted: boolean; providers?: string[] }): WorkspaceDef[] =>
  WORKSPACES.filter((w) =>
    w.access === 'local'
      ? !opts.hosted
      // A wallet source needs only the wallet the person signed in with.
      : w.access === 'wallet' ? true
        : !opts.providers || opts.providers.includes(w.provider!))

/** A granted connection: what the person allowed, and when. */
export type Grant = {
  workspaceId: string
  account: string
  scopes: Scope[]
  grantedAt: string
  /** Revoking keeps the record — the claims it wrote stay, and stay attributed. */
  revokedAt?: string
  /** How many findings the agent has consumed from this source. */
  cursor: number
  /** The last time a pass read this source, and how many findings it had — so "found nothing" is not shown as "still reading". */
  lastPass?: { at: string; found: number }
}

/** One thing the agent observed, ready to become a claim. */
export type ActivityItem = { workspaceId: string; text: string; actor: string; context: string; ref: string; marker: string }


/**
 * How to name and badge a provider in the interface.
 *
 * Derived from the workspaces rather than written beside them. The console kept
 * two hand-maintained copies of this, which had already drifted — Google was
 * rendered 🅖 in one place and 🔴 in another, and neither map knew Granola
 * existed, so its Connect button showed a raw id.
 */
const PROVIDER_LABELS: Record<string, { name: string; glyph: string }> = {
  github: { name: 'GitHub', glyph: '🐙' },
  google: { name: 'Google', glyph: '🅖' },
  linear: { name: 'Linear', glyph: '📐' },
  granola: { name: 'Granola', glyph: '🌀' },
}

export function providerLabel(provider: string): { name: string; glyph: string } {
  // A provider is not a workspace. One Google sign-in now serves two sources —
  // Calendar and mail, and the Takeout archive — which read different things
  // and promise different things, so the sign-in button names the account
  // rather than whichever source happened to be listed first.
  const known = PROVIDER_LABELS[provider]
  if (known) return known
  const ws = WORKSPACES.find((w) => w.provider === provider)
  if (ws) return { name: ws.name, glyph: ws.glyph }
  return { name: provider.charAt(0).toUpperCase() + provider.slice(1), glyph: '🔗' }
}

/** Sources that read files on this machine, for copy that has to enumerate them. */
export const localSources = (): WorkspaceDef[] => WORKSPACES.filter((w) => w.access === 'local')
