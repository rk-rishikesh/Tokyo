/**
 * How each source's events reach the service.
 *
 * Two shapes, both real: sources read from disk on this machine, and webhooks
 * that a product posts to. Nothing here is scripted — a connector reads real
 * data or it is not listed.
 */
import type { SourceKind } from '@knowledge01/core'
import type { ConnectorEvent } from './routing.js'

export type ConnectorDef = { id: string; name: string; kind: SourceKind; trigger: string; endpoint: string }

export const CONNECTORS: ConnectorDef[] = [
  { id: 'chrome', name: 'Browser history', kind: 'application', trigger: 'read from disk', endpoint: 'local file' },
  { id: 'editor', name: 'Editor projects', kind: 'application', trigger: 'read from disk', endpoint: 'local file' },
  { id: 'shell', name: 'Shell history', kind: 'application', trigger: 'read from disk', endpoint: 'local file' },
  { id: 'claude-code', name: 'Claude Code', kind: 'agent', trigger: 'knowledge_propose over MCP', endpoint: 'MCP server' },
  { id: 'slack', name: 'Slack', kind: 'application', trigger: '/knowledge or 📌 reaction', endpoint: 'POST /slack/events' },
  { id: 'webhook', name: 'Anything else', kind: 'application', trigger: 'a statement someone marked', endpoint: 'POST /event' },
]

export const byId = (id: string): ConnectorDef | undefined => CONNECTORS.find((c) => c.id === id)

/** What is actually delivering, rather than what could. */
export function connectorStatus(seen: Record<string, number>): (ConnectorDef & { events: number; live: boolean })[] {
  return CONNECTORS.map((c) => ({ ...c, events: seen[c.id] ?? 0, live: (seen[c.id] ?? 0) > 0 }))
}

// ---------------------------------------------------------------------------
// Slack — real webhook, for a workspace whose owner has registered an app
// ---------------------------------------------------------------------------

type SlackEnvelope = {
  type?: string; challenge?: string
  event?: { type?: string; reaction?: string; user?: string; text?: string; channel?: string; ts?: string; item?: { channel?: string; ts?: string } }
  team_domain?: string; channel_name?: string; user_name?: string; text?: string; command?: string
}

export type SlackResolved = { text: string; permalink?: string }

/**
 * Read a Slack payload into an event. Two triggers, both a deliberate human act:
 * `/knowledge <statement>`, or a 📌 reaction on a message whose text the caller
 * resolves. Anything else returns null — channel traffic is never read.
 */
export function fromSlack(body: SlackEnvelope, resolve?: (channel: string, ts: string) => SlackResolved | undefined): ConnectorEvent | null {
  const at = new Date().toISOString()
  const base = { connector: 'slack', sourceName: 'Slack', sourceKind: 'application' as SourceKind, at }

  if (body.command && typeof body.text === 'string' && body.text.trim()) {
    const permalink = body.team_domain && body.channel_name ? `https://${body.team_domain}.slack.com/archives/${body.channel_name}` : undefined
    return { ...base, text: body.text.trim(), actor: body.user_name ?? 'someone', trigger: `${body.command} command`, ...(body.channel_name ? { context: `#${body.channel_name}` } : {}), ...(permalink ? { ref: permalink } : {}) }
  }

  const e = body.event
  if (e?.type === 'reaction_added' && (e.reaction === 'pushpin' || e.reaction === 'bookmark')) {
    const channel = e.item?.channel; const ts = e.item?.ts
    if (!channel || !ts) return null
    const resolved = resolve?.(channel, ts)
    if (!resolved?.text) return null
    return { ...base, text: resolved.text, actor: e.user ?? 'someone', trigger: `:${e.reaction}: reaction`, context: `#${channel}`, ...(resolved.permalink ? { ref: resolved.permalink } : {}) }
  }
  return null
}

/** Slack verifies a new webhook URL by asking for its challenge back. */
export const slackChallenge = (body: SlackEnvelope): string | null => (body.type === 'url_verification' && body.challenge ? body.challenge : null)
