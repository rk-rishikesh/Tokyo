/**
 * The topics a claim can belong to, in one place.
 *
 * This list was written out four times — twice in the watcher and chat, twice
 * more in the model prompts, with two different lengths — and the console kept
 * its own unrelated map for display. The console's map shared *no keys* with
 * what the connectors actually produce, so every connector-written claim fell
 * through to a raw label: a namespace of `tools` rendered as "Tools" by
 * accident rather than by design, and `runbook` as "Runbook".
 *
 * A topic is the last segment of a namespace (`tools.you.eth`), the `type` a
 * claim gets, and the words a person reads. Keeping those together is what
 * stops them drifting apart.
 */

export type TopicDef = {
  id: string
  /** What a person reads in the interface. */
  label: string
  /** The claim type this topic implies. */
  type: string
  /** Whether the model may route to it. Some topics are only reached by rules. */
  forModel: boolean
  /** One line, for a prompt or a tooltip. */
  hint: string
}

/**
 * Where a claim goes when no rule matches.
 *
 * It used to be `decisions`, which is an assertion rather than an absence: a
 * claim nobody could classify was filed as something someone decided. `notes`
 * says what is true — it is knowledge, and we do not know what kind.
 */
export const FALLBACK_TOPIC = 'notes'

export const TOPICS: TopicDef[] = [
  { id: 'notes', label: 'Notes', type: 'note', forModel: false, hint: 'knowledge that does not fit the others' },
  { id: 'projects', label: 'Projects', type: 'fact', forModel: true, hint: 'things someone builds or works on' },
  { id: 'tools', label: 'Tools', type: 'fact', forModel: true, hint: 'software someone uses to work' },
  { id: 'portfolio', label: 'Portfolio', type: 'fact', forModel: false, hint: 'assets someone holds and protocols they use on chain' },
  { id: 'interests', label: 'Interests', type: 'fact', forModel: true, hint: 'subjects someone follows or reads about' },
  { id: 'conventions', label: 'Conventions', type: 'convention', forModel: false, hint: 'how a team agrees to do something' },
  { id: 'decisions', label: 'Decisions', type: 'decision', forModel: false, hint: 'a choice that was made, and stands' },
  { id: 'runbook', label: 'Operations', type: 'procedure', forModel: false, hint: 'what to do when something breaks' },
  { id: 'accounts', label: 'Accounts', type: 'fact', forModel: false, hint: 'customers, contracts and commercial terms' },
  { id: 'policy', label: 'Policy', type: 'policy', forModel: false, hint: 'rules that apply to people' },
]

export const TOPIC_IDS = TOPICS.map((t) => t.id)

/** Topics the model is allowed to choose, for the extraction prompts. */
export const MODEL_TOPICS = TOPICS.filter((t) => t.forModel).map((t) => t.id)

const BY_ID = new Map(TOPICS.map((t) => [t.id, t]))

export const topic = (id: string): TopicDef | undefined => BY_ID.get(id)

/** The claim type a topic implies, defaulting to a note for anything unknown. */
export const typeForTopic = (id: string): string => BY_ID.get(id)?.type ?? 'note'

/**
 * What a person reads for a topic.
 *
 * Falls back to capitalising, which is what a namespace someone else invented
 * deserves — `history.eth` is a real namespace and we have no map entry for it.
 */
export function topicLabel(id: string | null | undefined): string {
  if (!id) return 'General'
  const known = BY_ID.get(id)
  if (known) return known.label
  if (id.startsWith('repo:')) return `Project ${id.slice(5)}`
  return id.charAt(0).toUpperCase() + id.slice(1)
}

/** Claim types, in the words a person reads. */
const TYPE_LABELS: Record<string, string> = {
  fact: 'fact',
  decision: 'decision',
  convention: 'convention',
  procedure: 'way of working',
  policy: 'policy',
  preference: 'preference',
  event: 'event',
  note: 'note',
  observation: 'observation',
  memory: 'memory',
}

export const typeLabel = (t: string): string => TYPE_LABELS[t] ?? t
