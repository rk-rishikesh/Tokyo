/**
 * Subject addressing (PRD W1): a namespace is named for what it is about.
 * Who wrote a claim and where it came from are metadata on the claim, never a
 * branch of the tree. `food.rishikesh.eth`, not `swiggy.rishikesh.eth`.
 *
 * This is a heuristic warning, not a rule the protocol enforces: a source large
 * enough to be its own maintained body of knowledge (wikipedia.history.eth) is
 * the legitimate exception.
 */
export const ADDRESSING_RULE = 'Address by what someone would look for; attribute by who said it. Name namespaces for subjects (food.rishikesh.eth), and put the writer or source on the claim.'

const VENDOR_LIKE = new Set([
  'swiggy', 'zomato', 'uber', 'ola', 'amazon', 'flipkart', 'google', 'apple', 'microsoft', 'openai', 'anthropic', 'claude', 'chatgpt', 'gpt',
  'cursor', 'copilot', 'github', 'gitlab', 'slack', 'notion', 'linear', 'jira', 'mem0', 'supermemory', 'zep', 'letta', 'langchain',
  'wikipedia', 'medium', 'tabelog', 'yelp', 'tripadvisor', 'booking', 'airbnb', 'spotify', 'netflix',
])
const AGENT_SUFFIX = /(agent|bot|assistant|copilot|import|importer|sync|connector|integration|plugin|api|app)$/i

export type NamingWarning = { label: string; reason: 'vendor' | 'agent-shaped' | 'source-shaped'; message: string }

/** Warn when a child label looks like a writer, product or agent rather than a subject. */
export function checkSubjectAddressing(name: string): NamingWarning | null {
  const [label, ...rest] = name.toLowerCase().split('.')
  if (!label || rest.length < 2) return null // top-level names (x.eth) are identities; the rule is about children
  const core = label.replace(/[-_]/g, '')
  if (VENDOR_LIKE.has(core)) return { label, reason: 'vendor', message: `"${label}" looks like a vendor or product. ${ADDRESSING_RULE} Legitimate exception: a source publishing its own namespace (wikipedia.history.eth).` }
  if (AGENT_SUFFIX.test(label) && label.length > 4) return { label, reason: 'agent-shaped', message: `"${label}" looks like an agent or integration name. ${ADDRESSING_RULE}` }
  if (/^(import|source|feed|from)-/.test(label)) return { label, reason: 'source-shaped', message: `"${label}" names a source, not a subject. ${ADDRESSING_RULE}` }
  return null
}
