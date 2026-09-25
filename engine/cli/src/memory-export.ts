/**
 * Import a memory export from another assistant (PRD: portability made concrete).
 *
 * The argument the comparison page makes — *persistent for the application, not
 * for you* — is a slide until someone can leave a vendor and keep what it
 * learned. This is that path: take the export an assistant gives you, turn each
 * remembered fact into a claim in a namespace you own, cite the assistant as the
 * source, and route it through the ordinary propose path.
 *
 * Export formats differ between vendors and change without notice, so this reads
 * several known shapes and falls back to "any object with a text-ish field",
 * rather than pretending to know one schema. Nothing is invented: a line that
 * cannot be read as a remembered fact is skipped and counted.
 *
 * What it never does: parse conversation transcripts to infer facts. An export's
 * `conversations.json` is raw material for an LLM, not for a deterministic
 * importer — inventing claims from chat logs would put unsourced statements in a
 * namespace whose whole point is provenance.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { Knowledge, Proposal, Source, SourceKind } from '@recall/core'
import type { Repository } from '@recall/repo'

export type Vendor = { id: string; name: string; kind: SourceKind }

export const VENDORS: Record<string, Vendor> = {
  chatgpt: { id: 'chatgpt', name: 'ChatGPT', kind: 'application' },
  claude: { id: 'claude', name: 'Claude', kind: 'application' },
  instinct: { id: 'instinct', name: 'Instinct', kind: 'application' },
  mem0: { id: 'mem0', name: 'Mem0', kind: 'application' },
  supermemory: { id: 'supermemory', name: 'Supermemory', kind: 'application' },
  generic: { id: 'memory-export', name: 'Memory export', kind: 'application' },
}

/** One remembered fact, as read out of an export. */
export type ExportedMemory = { text: string; created?: string; id?: string; tags?: string[] }

/** Keys an export might use for the remembered text, most specific first. */
const TEXT_KEYS = ['memory', 'text', 'content', 'fact', 'statement', 'value', 'body', 'summary', 'note']
const TIME_KEYS = ['created_at', 'createdAt', 'created', 'timestamp', 'time', 'date', 'update_time', 'updated_at']
const ID_KEYS = ['id', 'memory_id', 'uuid', 'key']

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

function readTime(o: Record<string, unknown>): string | undefined {
  for (const k of TIME_KEYS) {
    const v = o[k]
    if (typeof v === 'string' && !Number.isNaN(Date.parse(v))) return new Date(v).toISOString()
    if (typeof v === 'number' && v > 1_000_000_000) return new Date(v > 1e12 ? v : v * 1000).toISOString()
  }
  return undefined
}

/** Read one entry of an export into a remembered fact, or null if it is not one. */
function readEntry(x: unknown): ExportedMemory | null {
  if (typeof x === 'string') { const t = x.trim(); return t.length > 8 ? { text: t } : null }
  if (!isRecord(x)) return null
  for (const k of TEXT_KEYS) {
    const v = x[k]
    if (typeof v === 'string' && v.trim().length > 8) {
      const id = ID_KEYS.map((i) => x[i]).find((i) => typeof i === 'string') as string | undefined
      const tags = Array.isArray(x.tags) ? (x.tags.filter((t) => typeof t === 'string') as string[]) : undefined
      return { text: v.trim(), ...(readTime(x) ? { created: readTime(x) } : {}), ...(id ? { id } : {}), ...(tags?.length ? { tags } : {}) }
    }
  }
  return null
}

/**
 * Find the remembered facts in a parsed export.
 *
 * Walks the object graph for arrays whose entries read as remembered facts,
 * preferring containers named like memory. Conversation transcripts are skipped
 * on purpose (see the file comment).
 */
export function extractMemories(parsed: unknown): { memories: ExportedMemory[]; skipped: number; from: string } {
  const CONVERSATION_KEYS = new Set(['conversations', 'messages', 'mapping', 'chats', 'chat_messages', 'transcript'])
  const MEMORY_HINTS = /memor|fact|preference|profile|knowledge|about_?(me|user)|personalization|instruction/i
  let best: { memories: ExportedMemory[]; skipped: number; from: string } | null = null

  const visit = (node: unknown, path: string, depth: number): void => {
    if (depth > 6 || node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      const read = node.map(readEntry)
      const memories = read.filter((m): m is ExportedMemory => !!m)
      const skipped = read.length - memories.length
      if (memories.length) {
        const hinted = MEMORY_HINTS.test(path)
        const score = memories.length + (hinted ? 10_000 : 0)
        const bestScore = best ? best.memories.length + (MEMORY_HINTS.test(best.from) ? 10_000 : 0) : -1
        if (score > bestScore) best = { memories, skipped, from: path || '(root array)' }
      }
      for (const [i, item] of node.entries()) visit(item, `${path}[${i}]`, depth + 1)
      return
    }
    for (const [k, v] of Object.entries(node)) {
      if (CONVERSATION_KEYS.has(k)) continue // transcripts are not remembered facts
      visit(v, path ? `${path}.${k}` : k, depth + 1)
    }
  }
  visit(parsed, '', 0)
  return best ?? { memories: [], skipped: 0, from: '' }
}

/** Read an export file, or the memory-ish JSON files inside an unzipped export directory. */
export function readExport(path: string): { parsed: unknown; file: string } {
  const st = statSync(path)
  if (st.isDirectory()) {
    const files = readdirSync(path).filter((f) => f.endsWith('.json'))
    const preferred = files.find((f) => /memor|fact|profile|about/i.test(f)) ?? files.find((f) => !/conversation|message|chat/i.test(f)) ?? files[0]
    if (!preferred) throw new Error(`no .json file in ${path} — point at the export file itself`)
    return { parsed: JSON.parse(readFileSync(join(path, preferred), 'utf8')), file: join(path, preferred) }
  }
  const raw = readFileSync(path, 'utf8')
  // Some exports are JSON Lines rather than one document.
  if (!raw.trimStart().startsWith('[') && !raw.trimStart().startsWith('{')) throw new Error(`${path} is not JSON`)
  try { return { parsed: JSON.parse(raw), file: path } } catch {
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
    if (!lines.length) throw new Error(`${path} is not valid JSON or JSON Lines`)
    return { parsed: lines, file: path }
  }
}

/**
 * Route a remembered fact to a topic in the owner's namespace.
 *
 * Subject addressing (PRD W1) is about namespaces; within one namespace a topic
 * is still useful. Keyword routing is deliberately dumb and visible — the
 * alternative is an LLM deciding silently where someone's personal facts go.
 */
const TOPIC_RULES: [RegExp, string][] = [
  [/\b(eats?|food|vegetarian|vegan|allerg\w*|diet|restaurants?|coffee|cuisine|meals?|breakfast|lunch|dinner)\b/i, 'food'],
  [/\b(travels?|travelling|traveling|flights?|hotels?|trips?|visas?|airports?|abroad|lives? in|based in)\b/i, 'travel'],
  [/\b(work|job|company|team|colleagues?|manager|role|career|meetings?|standup|async)\b/i, 'work'],
  [/\b(code|codebase|repo|typescript|javascript|python|rust|framework|librar\w+|deploys?|tests?|vitest|jest|pnpm|npm|monorepo|commits?|ens|ipfs)\b/i, 'code'],
  [/\b(famil\w+|wife|husband|partner|son|daughter|friends?|birthday|parents?)\b/i, 'people'],
  [/\b(health|exercise|sleep|doctor|medic\w+|fitness|running|gym)\b/i, 'health'],
  [/\b(tone|concise|verbose|brief|format|bullet|prose|answers?|responses?|respond|explanations?)\b/i, 'style'],
]

/** Whichever topic the text matches most; ties break in rule order. Deliberately visible and dumb. */
export function topicFor(text: string): string {
  let best: { topic: string; hits: number } | null = null
  for (const [re, topic] of TOPIC_RULES) {
    const hits = (text.match(new RegExp(re.source, 'gi')) ?? []).length
    if (hits && (!best || hits > best.hits)) best = { topic, hits }
  }
  return best?.topic ?? 'general'
}

/**
 * A short subject for the claim — the thing it is about, not the sentence.
 * The topic is the fallback, because a wrong-but-short subject is worse than a
 * general one: subject and topic together decide what merges with what.
 */
export function subjectFor(text: string, topic = topicFor(text)): string {
  const cleaned = text
    .replace(/^(the )?user('s)?\s+/i, '')
    .replace(/^(i|they|he|she)\s+/i, '')
    .replace(/^(prefers?|likes?|dislikes?|avoids?|wants?|uses?|is|are|was|has|have|works?|lives?|travels?|runs?)\s+/i, '')
    .replace(/^(a|an|the|to|in|on|with|mainly|mostly|always|often)\s+/i, '')
    .trim()
  const words = cleaned.split(/\s+/).filter((w) => w.length > 1).slice(0, 3).join(' ').replace(/[.,;:]+$/, '')
  if (words.length < 3) return topic.charAt(0).toUpperCase() + topic.slice(1)
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export type ImportPlan = {
  vendor: Vendor
  file: string
  from: string
  /** Grouped by the namespace each claim would go to. */
  byNamespace: Record<string, { item: Omit<Knowledge, 'id' | 'created_at' | 'reviewers'> & { contributor: string }; memory: ExportedMemory }[]>
  skipped: number
}

/**
 * Plan an import without writing anything: which claims, in which namespaces.
 * `split` sends each topic to its own subject-addressed namespace under the
 * owner's name (food.alice.eth), which is the addressing rule made real.
 */
export function planImport(
  parsed: unknown,
  opts: { vendor: Vendor; file: string; owner: string; namespace: string; split?: boolean; confidence?: number; limit?: number },
): ImportPlan {
  const { memories, skipped, from } = extractMemories(parsed)
  const chosen = opts.limit ? memories.slice(0, opts.limit) : memories
  const byNamespace: ImportPlan['byNamespace'] = {}
  for (const m of chosen) {
    const topic = topicFor(m.text)
    const ns = opts.split ? `${topic}.${opts.owner}` : opts.namespace
    const source: Source = {
      type: 'memory-export', kind: opts.vendor.kind, name: opts.vendor.name,
      title: `exported from ${opts.vendor.name}`, ...(m.id ? { id: m.id } : {}), excerpt: m.text,
    }
    const item = {
      claim: m.text, subject: subjectFor(m.text, topic), topic: opts.split ? null : topic, type: 'preference',
      confidence: opts.confidence ?? 0.7, sources: [source], tags: m.tags ?? [], contributor: opts.owner,
      ...(m.created ? { updated_at: m.created } : {}),
    }
    ;(byNamespace[ns] ??= []).push({ item: item as ImportPlan['byNamespace'][string][number]['item'], memory: m })
  }
  return { vendor: opts.vendor, file: opts.file, from, byNamespace, skipped }
}

/**
 * Apply a plan to one repository: add the claims and land them.
 *
 * On a namespace with history this goes through the ordinary propose path, so a
 * shared namespace reviews an import like any other contribution. A namespace
 * with no commits yet has nothing to branch from, so the first import commits
 * to the default branch directly — which is also what the owner expects when
 * the import is what creates the namespace.
 */
export function applyImport(
  repo: Repository,
  entries: ImportPlan['byNamespace'][string],
  vendor: Vendor,
  opts: { message?: string } = {},
): { proposal?: Proposal; commit?: string; items: Knowledge[] } {
  const author = entries[0]?.item.contributor ?? 'import'
  const title = opts.message ?? `Import ${entries.length} memor${entries.length === 1 ? 'y' : 'ies'} from ${vendor.name}`
  const description = `Imported from a ${vendor.name} data export. Each claim cites the export as its source and keeps the original text as the excerpt; nothing was inferred from conversation transcripts.`

  if (!repo.headCommit(repo.refs.head)) {
    const prev = repo.branch
    if (prev !== repo.refs.head) repo.checkout(repo.refs.head)
    const items = entries.map(({ item }) => repo.add(item))
    const commit = repo.commit(title, { author })
    return { commit: commit.id, items }
  }

  const prev = repo.branch
  const branch = `import/${vendor.id}-${Date.now().toString(36)}`
  repo.checkout(branch, { create: true })
  try {
    const items = entries.map(({ item }) => repo.add(item))
    repo.commit(title, { author })
    const proposal = repo.propose({ title, description, branch })
    return { proposal, items }
  } finally {
    if (repo.branch !== prev) repo.checkout(prev)
  }
}
