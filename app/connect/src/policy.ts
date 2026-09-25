/**
 * What each source reads, and how much of it has to be there before it counts.
 *
 * Every number the product uses to decide what gets remembered lives here. They
 * were literals spread across eight files, which is how the consent screen came
 * to promise "90 days" of GitHub history while the reader had been changed to
 * 15 — the copy and the code stated the same fact in two places and only one of
 * them got updated.
 *
 * So the copy is generated from these values rather than written beside them.
 * A threshold and the sentence describing it cannot drift if the sentence is
 * built from the threshold.
 *
 * These are tuning decisions, not constants. They belong to the deployment, and
 * eventually to the person whose memory it is — "why was this not remembered"
 * deserves an answer better than reading our source.
 */

export type SourcePolicy = {
  /** How far back a pass looks. */
  windowDays: number
  /**
   * The bar a thing must clear to become a claim, and the noun to describe it.
   * `min` of 1 means anything inside the window counts.
   */
  min: number
  minLabel: string
  /** How many findings one pass will keep at most. */
  keep: number
}

export const POLICY = {
  chrome: {
    windowDays: 90,
    /** The short window that makes the watcher react to today, not last quarter. */
    recentDays: 3,
    min: 150,
    minLabel: 'visits',
    minPages: 40,
    /** A site must also be this share of the busiest site, so a quiet life is not all noise. */
    topShare: 0.05,
    /**
     * How much more deeply a host must be used than this person's median site
     * before it counts as something they build rather than something they use.
     *
     * Measured on real history: a product someone builds sits near 15 visits
     * per distinct page while every platform sits between 1 and 4, so the
     * median is a platform and anything at twice it is unusual.
     */
    depthRatio: 2.2,
    /**
     * In the short window, how many more distinct pages than the median a host
     * needs before it counts as something someone builds.
     *
     * Over three days depth says nothing — an inbox checked hourly is deeper
     * than any project — but a project still has many more distinct pages,
     * because it has routes and records rather than one refreshed screen.
     */
    breadthRatio: 3,
    keep: 60,
  },
  github: {
    windowDays: 15,
    min: 1,
    minLabel: 'contribution',
    /** Saying what someone *writes* is a broader claim than naming a repository. */
    minForLanguage: 5,
    /** A fork touched once is a drive-by fix, not a project. */
    minForFork: 2,
    keep: 10,
  },
  linear: {
    windowDays: 0,
    min: 3,
    minLabel: 'assigned issues',
    keep: 5,
  },
  granola: {
    windowDays: 0,
    min: 3,
    minLabel: 'meetings with the same title',
    keep: 8,
  },
  // Calendar and Gmail are one grant and one consent screen, so they share a
  // window. The per-reader bars differ and are named separately.
  google: {
    windowDays: 90,
    min: 4,
    minLabel: 'occurrences',
    /** Calendar: how often a title must recur to be a pattern. */
    minMeetings: 4,
    /** Gmail: how many messages from a domain make it a service you use. */
    minMessages: 5,
    /**
     * Data Portability: how often someone must order from a merchant before it
     * is a habit rather than a receipt.
     */
    minOrders: 3,
    /** And how many videos from a channel before they follow it. */
    minWatches: 5,
    keep: 8,
  },
  takeout: {
    // The archive covers whatever Google holds; there is no window to ask for.
    windowDays: 0,
    min: 3,
    minLabel: 'orders from the same place',
    keep: 8,
  },
  'claude-code': {
    windowDays: 14,
    min: 2,
    minLabel: 'sessions',
    /** Or this many in total, for a project worked on steadily rather than lately. */
    minSustained: 5,
    keep: 12,
  },
  shell: {
    windowDays: 0,
    min: 10,
    minLabel: 'times run',
    keep: 8,
  },
  editor: {
    windowDays: 0,
    min: 1,
    minLabel: 'project',
    keep: 12,
  },
  ethereum: {
    /** How far back outgoing transactions are counted. */
    windowDays: 180,
    min: 3,
    minLabel: 'transactions with a contract',
    /** A contract called this many times in the window is a protocol you use, not a one-off. */
    minInteractions: 3,
    /** This many transactions in the window reads as "active". */
    minActive: 10,
    /** Holding less than this much ETH is dust, not a holding. */
    minEth: 0.01,
    /** A priced token worth less than this (USD) is dust. */
    minTokenUsd: 10,
    /** Below this circulating market cap (USD) a token is treated as an airdrop, not a holding. */
    minMarketCapUsd: 100_000_000,
    keepTokens: 5,
    keepProtocols: 5,
    /** Pages of 50 transactions read per pass, at most. */
    pages: 3,
    keep: 12,
  },
} as const

export type SourceId = keyof typeof POLICY

export const policyFor = (id: string): (typeof POLICY)[SourceId] | undefined =>
  (POLICY as Record<string, (typeof POLICY)[SourceId]>)[id]

/**
 * "over the last 15 days", or nothing for a source with no window.
 *
 * Written as a phrase rather than a number so callers cannot accidentally put
 * it in a sentence that implies a window where there is none.
 */
export function windowPhrase(id: string): string {
  const p = policyFor(id)
  if (!p?.windowDays) return ''
  return ` over the last ${p.windowDays} days`
}

/** "in 15 days" — for evidence on a claim, where brevity matters more. */
export function periodPhrase(days: number): string {
  return days ? ` in ${days} day${days === 1 ? '' : 's'}` : ''
}


/**
 * How much to trust a claim, by where it came from.
 *
 * Every connector claim used to be 0.85 — one constant, regardless of whether
 * it came from a thousand visits or a single meeting. That made the number
 * decorative: the console's "not very sure" badge fires below 0.7 and could
 * never fire, because nothing was ever below 0.85.
 *
 * Confidence is supposed to say how much evidence there is. A rule that counted
 * a thousand visits has more than a model that inferred something from a page
 * title, and both have more than a single observation.
 */
export const CONFIDENCE = {
  /** A deterministic rule over a lot of evidence: counts, thresholds, a real pattern. */
  rules: 0.85,
  /** A model reading the same data. It sees more, and is wrong more often. */
  model: 0.7,
  /** One occurrence, kept because it is still true — a single meeting, one commit. */
  sparse: 0.6,
  /** Someone stated it themselves. */
  human: 0.9,
} as const

/**
 * The confidence a finding deserves.
 *
 * `by` is how it was produced; `weak` marks a finding the reader itself knows
 * rests on a single observation.
 */
export function confidenceFor(by: 'rules' | 'model' | 'human', weak = false): number {
  if (by === 'human') return CONFIDENCE.human
  if (weak) return CONFIDENCE.sparse
  return by === 'model' ? CONFIDENCE.model : CONFIDENCE.rules
}


/**
 * Settings that are not about a source.
 *
 * Each was a literal at its point of use, and two of them were the same number
 * written twice: the session cookie's max age and the age the verifier will
 * accept. Those drifting apart means a browser holding a cookie the server has
 * decided is expired.
 */
export const SESSION = {
  /** How long a signed-in session lasts. */
  days: 30,
} as const

export const AGENT = {
  /** How often the page asks the agent to run while someone is watching. */
  pollSeconds: 15,
  /**
   * How alike two claims must be before the later one is a restatement.
   *
   * Word overlap alone is weak here — "Tracks work in Linear" and "Uses Linear
   * for project tracking" share one token — so this is the second of two tests,
   * the other being that they resolve to the same subject.
   */
  restatementSimilarity: 0.6,
} as const
