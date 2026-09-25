/**
 * Agent B's whole world: a key, a list of what it was granted, and the network.
 *
 * It imports the engine and nothing else. It has never seen the app's
 * directory, its database or its API, and `check:layering` fails the build if
 * that changes. When the app is deleted, nothing this file reads goes with it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { publicKeyFromPrivate } from '@recall/core'
import { config } from 'dotenv'
import {
  AccessDenied, NotPublished, ensNetwork, localNetwork, localNetworkDir, resolveNamespace,
  type Network, type ResolvedNamespace,
} from '@recall/repo'
import { createStorage } from '@recall/storage'
import { createPublicClient, http, type Hex, type PublicClient } from 'viem'
import { generatePrivateKey } from 'viem/accounts'
import { sepolia } from 'viem/chains'

// The repository's .env, for the RPC and the IPFS gateway — both public
// endpoints. Nothing in it is the app's: Agent B needs no credential of theirs.
config({ path: new URL('../../../.env', import.meta.url).pathname, quiet: true } as never)

export const AGENT_NAME = 'Agent B'

/** Agent B's own directory. Not the app's, and not the network's. */
export function agentDir(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.AGENT_B_DIR?.trim() || '~/.agent-b'
  return base.startsWith('~') ? join(homedir(), base.slice(1)) : resolve(base)
}

type KeyFile = { privateKey: Hex; createdAt: string }
type GrantsFile = { owner?: string; namespaces: string[]; requested: string[]; updatedAt: string }

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null
  try { return JSON.parse(readFileSync(path, 'utf8')) as T } catch { return null }
}
function writeJson(path: string, value: unknown): void {
  mkdirSync(agentDir(), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2), { mode: 0o600 })
}

/** Generated on first run and kept only here. The app never sees the private half. */
export function identity(): { privateKey: Hex; pubkey: Hex; createdAt: string } {
  const path = join(agentDir(), 'key.json')
  let k = readJson<KeyFile>(path)
  if (!k) {
    k = { privateKey: generatePrivateKey(), createdAt: new Date().toISOString() }
    writeJson(path, k)
  }
  return { ...k, pubkey: publicKeyFromPrivate(k.privateKey) }
}

export function grants(): GrantsFile {
  return readJson<GrantsFile>(join(agentDir(), 'grants.json')) ?? { namespaces: [], requested: [], updatedAt: '' }
}

export function saveGrants(g: Omit<GrantsFile, 'updatedAt'>): void {
  writeJson(join(agentDir(), 'grants.json'), { ...g, updatedAt: new Date().toISOString() })
}

/**
 * Where Agent B reads. On chain by default when an IPFS gateway is known: the
 * name's records through the Universal Resolver, the bytes through the gateway
 * — no write credential, and nothing of the app's. `AGENT_B_NETWORK=local`
 * reads the staged directory instead, for trying things before publishing.
 */
export const networkKind = (): 'sepolia' | 'local' =>
  process.env.AGENT_B_NETWORK === 'local' || !process.env.PINATA_GATEWAY?.trim() ? 'local' : 'sepolia'

let net: Network | null = null
export const network = (): Network => (net ??= networkKind() === 'local'
  ? localNetwork(localNetworkDir())
  : ensNetwork({
    // Read-only: the gateway serves anyone, so the pinning credential is dropped.
    storage: createStorage('pinata', { PINATA_GATEWAY: process.env.PINATA_GATEWAY }),
    client: createPublicClient({ chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL?.trim() || 'https://ethereum-sepolia-rpc.publicnode.com') }) as PublicClient,
  }))

export const networkWhere = (): string => (networkKind() === 'local' ? localNetworkDir() : 'Sepolia ENS + IPFS')

export type Reading =
  | { namespace: string; ok: true; data: ResolvedNamespace }
  | { namespace: string; ok: false; reason: 'denied' | 'unpublished' | 'error'; detail: string }

/** Read one namespace from the network, with this agent's key. */
export async function read(namespace: string): Promise<Reading> {
  try {
    return { namespace, ok: true, data: await resolveNamespace(network(), namespace, { privateKey: identity().privateKey }) }
  } catch (e) {
    if (e instanceof AccessDenied) return { namespace, ok: false, reason: 'denied', detail: e.message }
    if (e instanceof NotPublished) return { namespace, ok: false, reason: 'unpublished', detail: e.message }
    return { namespace, ok: false, reason: 'error', detail: e instanceof Error ? e.message : String(e) }
  }
}

/** Everything it was granted, and everything it asked for and was not. */
export async function readAll(): Promise<Reading[]> {
  const g = grants()
  const names = [...new Set([...g.namespaces, ...g.requested])]
  return Promise.all(names.map(read))
}

// ---------------------------------------------------------------------------
// Answering — optional, and only from what it could read
// ---------------------------------------------------------------------------

/**
 * Answer a question from the claims it can read.
 *
 * With OPENROUTER_API_KEY set, a model phrases the answer from those claims
 * alone. Without it, the answer is the matching claims themselves. Either way
 * the context is exactly what the network gave it — which is the point.
 */
export async function answer(question: string): Promise<{ text: string; used: { namespace: string; claim: string; source: string }[]; model: string | null }> {
  const readable = (await readAll()).filter((r): r is Extract<Reading, { ok: true }> => r.ok)
  const facts = readable.flatMap((r) => r.data.claims.map((c) => ({
    namespace: r.namespace,
    claim: c.claim,
    source: c.sources.map((s) => s.name ?? s.type).join(', ') || 'unsourced',
  })))
  if (!facts.length) return { text: 'I have not been granted anything to read yet, so I know nothing about you.', used: [], model: null }

  const words = question.toLowerCase().split(/\W+/).filter((w) => w.length > 2)
  const relevant = facts.filter((f) => words.some((w) => f.claim.toLowerCase().includes(w) || f.namespace.includes(w)))
  const used = relevant.length ? relevant : facts

  const key = process.env.OPENROUTER_API_KEY?.trim()
  if (!key) return { text: used.map((f) => `• ${f.claim}`).join('\n'), used, model: null }

  const model = process.env.AGENT_B_MODEL?.trim() || process.env.KNOWLEDGE_MODEL?.trim() || 'qwen/qwen3.8-27b:free'
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: `You are ${AGENT_NAME}, an assistant that was just granted read access to part of a person's memory. Answer only from the claims below. If they do not answer the question, say so. Never invent.\n\n${facts.map((f) => `- [${f.namespace}] ${f.claim} (source: ${f.source})`).join('\n')}` },
        { role: 'user', content: question },
      ],
    }),
  }).catch(() => null)
  const body = res?.ok ? await res.json().catch(() => null) as { choices?: { message?: { content?: string } }[] } | null : null
  const text = body?.choices?.[0]?.message?.content?.trim()
  return text ? { text, used, model } : { text: used.map((f) => `• ${f.claim}`).join('\n'), used, model: null }
}
