/**
 * Where an event's claim goes, and whether it is a claim at all.
 *
 * Two rules from the PRD do the work here:
 *   W1 — namespaces name subjects, never sources. A Slack decision lands in
 *        decisions.acme.eth with `source: Slack`, never in slack.acme.eth.
 *   The source boundary — a message is not a claim. Only a human marking one
 *        ("this is a decision") turns an event into knowledge. That marking is
 *        what keeps extraction honest: the marked text *is* the claim, so
 *        nothing is inferred and nothing is invented.
 */
import { FALLBACK_TOPIC, typeForTopic } from './topics.js'
import { confidenceFor } from './policy.js'
import type { SourceKind } from '@recall/core'

/** An event as a connector hands it over, before any decision about it. */
export type ConnectorEvent = {
  /** Which connector: slack, gmail, linear, notion, claude-code… */
  connector: string
  /** The product name recorded on the claim. */
  sourceName: string
  sourceKind: SourceKind
  /** The text a person marked. This becomes the claim verbatim. */
  text: string
  /** Who marked it — the contributor on the claim. */
  actor: string
  /** A link back to the original: permalink, message id, issue url. */
  ref?: string
  /** Why the connector thinks this is knowledge: the reaction, command or label used. */
  trigger: string
  /**
   * How this was produced. A deterministic rule over counted evidence is worth
   * more than a model's reading of the same data, and the claim's confidence
   * should say so.
   */
  by?: 'rules' | 'model' | 'human'
  /** Set when the reader knows this rests on a single observation. */
  weak?: boolean
  /** Channel, mailbox label, project — used for routing. */
  context?: string
  at: string
}

export type Routed = {
  namespace: string
  subject: string
  topic: string
  type: string
  confidence: number
}

/**
 * Keyword → topic, scored by how many signals match rather than first-match:
 * "Production deploys require a second approver" carries both a decision word
 * and two runbook words, and belongs in the runbook.
 */
const TOPIC_RULES: [RegExp, string][] = [
  // On-chain holdings and activity. First, so "Uses Uniswap on Ethereum" is a
  // portfolio fact rather than a tool — ties break in rule order.
  [/\b(on ethereum|on-?chain|holds?|staked?|yield|liquidity pool|wallet)\b/gi, 'portfolio'],
  [/\b(incident|runbook|rollback|on-?call|postmortem|outage|approver|production deploys?|staging)\b/gi, 'runbook'],
  [/\b(convention|always|never|must|should|standard|style|lint|prefer|instead of|not npm|not yarn)\b/gi, 'conventions'],
  [/\b(price|pricing|contract|invoice|renewal|terms|sla|vendor|customer|payment|discount)\b/gi, 'accounts'],
  [/\b(hire|hiring|onboard\w*|joiners?|employees?|staff|leave|holiday|expenses?|handbook|entitlement|laptop|equipment|benefits?)\b/gi, 'policy'],
  [/\b(decided?|decision|agreed?|we will|going with|chose|rejected|dropped|shipping)\b/gi, 'decisions'],
  // Patterns a browser or editor observes about how someone works.
  [/\b(works? on|building|maintains?|project is built with)\b/gi, 'projects'],
  [/\b(uses?|tracks? work|deploys? on|designs? in|keeps? documentation|reads? \w+ regularly)\b/gi, 'tools'],
]

/** Whichever topic the text matches most; ties break in rule order. Deliberately visible. */
export function topicFor(text: string): string {
  let best: { topic: string; hits: number } | null = null
  for (const [re, topic] of TOPIC_RULES) {
    const hits = (text.match(re) ?? []).length
    if (hits && (!best || hits > best.hits)) best = { topic, hits }
  }
  // No rule matched. Filing it as a decision would assert something nobody
  // said; the honest answer is that this is knowledge of an unknown kind.
  return best?.topic ?? FALLBACK_TOPIC
}


/** A short subject: the thing the claim is about. Falls back to the topic. */
export function subjectFor(text: string, topic: string): string {
  const cleaned = text
    .replace(/^(we|i|they|the team)\s+/i, '')
    .replace(/^(decided|agreed|will|are|have|chose)\s+(to\s+)?/i, '')
    // Pattern claims name their object: "Uses GitHub for…" → GitHub, "Works on Loops House (host)" → Loops House,
    // "Works with Nick" → Nick. Without the last, every colleague shared one subject, "Works",
    // and two colleagues read as a contradiction.
    .replace(/^(uses?|holds?|is active|works? on|works? with|meets? with|tracks? work in|deploys? on|designs? in|keeps? documentation in|reads?)\s+/i, '')
    .replace(/^(a|an|the|that)\s+/i, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim()
  // The subject is the entity, not the sentence. A model states the same fact
  // many ways — "Uses Linear for project tracking", "Uses Linear for task and
  // sprint tracking" — and everything from `for`/`to`/`as` onward is predicate,
  // not subject. Keeping it would make each phrasing a different subject, and
  // since claims merge on subject, the namespace would collect one claim per
  // wording instead of one claim per thing.
  const head = cleaned
    .split(/\s+(?:for|to|as|when|while|with|during|on behalf of)\s+/i)[0]!
    // "Loops House, an AI-native hackathon platform" → "Loops House"
    .split(/\s*[,;:—–]\s*/)[0]!
    .trim()
  const words = (head || cleaned).split(/\s+/).filter((w) => w.length > 1).slice(0, 4).join(' ').replace(/[.,;:!?]+$/, '')
  if (words.length < 3) return topic.charAt(0).toUpperCase() + topic.slice(1)
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * Route an event to a namespace under `owner`.
 *
 * Personal connectors (an assistant's memory) go to a personal subject namespace;
 * workspace connectors go to the organisation's. Either way the namespace names
 * the subject and the connector's product name goes on the claim.
 */
export function route(event: ConnectorEvent, opts: { owner: string; personal?: boolean }): Routed {
  const topic = topicFor(event.text)
  return {
    namespace: `${topic}.${opts.owner}`,
    subject: subjectFor(event.text, topic),
    topic,
    type: typeForTopic(topic),
    // How the finding was produced decides how much it is worth. A rule that
    // counted a thousand visits is not the same evidence as a model reading a
    // page title, and neither is the same as a single meeting — one constant
    // for all three made the number decorative.
    confidence: confidenceFor(event.by ?? 'rules', event.weak ?? false),
  }
}

/**
 * Is this event something a second party would want the source of?
 *
 * The test from the comparison page, applied. A claim states something that is
 * true or false about the world. Chatter, questions, scheduling and pleasantries
 * are not claims however long they run — an agent that keeps them is the failure
 * mode we are arguing against, so the bar is deliberately high and every
 * rejection says why.
 */
export function isKnowledge(event: ConnectorEvent): { ok: boolean; reason?: string } {
  const t = event.text.trim()
  if (t.length < 15) return { ok: false, reason: 'too short to be a claim' }
  if (/\?\s*$/.test(t)) return { ok: false, reason: 'a question, not a claim' }
  // Pleasantries and social acknowledgement, however long the sentence runs.
  if (/^(thanks|thank you|ok|okay|lol|\+1|done|yes|no|sure|got it|sounds good|great|nice|agreed|will do|on it|ack)\b/i.test(t)) {
    return { ok: false, reason: 'acknowledgement, not a claim' }
  }
  // "talk tomorrow", "see you at 3" — social scheduling, not a durable fact.
  if (/\b(talk|speak|catch up|see you|chat)\b.{0,20}\b(tomorrow|later|soon|monday|tuesday|wednesday|thursday|friday|next week)\b/i.test(t)) {
    return { ok: false, reason: 'social scheduling, not a claim' }
  }
  // A claim asserts something. Either a verb doing work ("the SLA *is* four hours"),
  // or an imperative rule ("*never* cache token ids") — conventions are usually the
  // latter, and rejecting them would throw away the most useful claims there are.
  const asserts = /\b(is|are|was|were|has|have|had|will|must|should|does|do|did|uses?|requires?|prefers?|decided?|agreed?|dropped|moved|gets?|runs?|costs?|takes?|needs?|supports?|allows?|goes|lives?|works?|ships?|blocks?|covers?|deploys?|tracks?|designs?|reads?|keeps?|builds?|maintains?)\b/i.test(t)
  const imperative = /^(never|always|do not|don't|avoid|use|prefer|keep|treat|ensure|make sure|only)\b/i.test(t)
  if (!asserts && !imperative) return { ok: false, reason: 'no statement — nothing here is true or false' }
  return { ok: true }
}
