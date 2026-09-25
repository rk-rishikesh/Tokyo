/**
 * MultiBaas, as the treasury dashboard's view of Base mainnet.
 *
 * One deployment (MULTIBAAS_URL) is bound to one chain — Base here — and every
 * read goes through its REST API: token balances by calling `balanceOf` on the
 * built-in ERC-20 ABI, contract state by calling view functions, and activity
 * from its event indexer and saved event queries.
 *
 * The free plan allows 30,000 calls a month, so every read is cached, and the
 * dashboard reads the watcher's snapshot in treasury.eth rather than calling
 * live on every page view.
 */
const base = () => {
  const url = process.env.MULTIBAAS_URL?.trim().replace(/\/+$/, '')
  if (!url) throw new Error('MULTIBAAS_URL is not set')
  return `${url}/api/v0`
}
const key = () => {
  const k = process.env.MULTIBAAS_API_KEY?.trim().replace(/^=+/, '')
  if (!k) throw new Error('MULTIBAAS_API_KEY is not set')
  return k
}

export const multibaasConfigured = (): boolean => !!process.env.MULTIBAAS_URL?.trim() && !!process.env.MULTIBAAS_API_KEY?.trim()

type Envelope<T> = { status: number; message: string; result: T }

// Reads are cached per path+body; a treasury does not change by the second.
const cache = new Map<string, { at: number; value: unknown }>()
const TTL_MS = 5 * 60_000

async function request<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, opts: { ttlMs?: number } = {}): Promise<T> {
  const ttl = opts.ttlMs ?? (method === 'GET' || path.includes('/methods/') ? TTL_MS : 0)
  const id = `${method} ${path} ${body ? JSON.stringify(body) : ''}`
  const hit = ttl ? cache.get(id) : undefined
  if (hit && Date.now() - hit.at < ttl) return hit.value as T

  const r = await fetch(`${base()}${path}`, {
    method,
    headers: { authorization: `Bearer ${key()}`, 'content-type': 'application/json', accept: 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(25_000),
    cache: 'no-store',
  })
  const json = (await r.json().catch(() => null)) as Envelope<T> | null
  if (!r.ok || !json || json.status !== 200) throw new Error(`MultiBaas ${method} ${path.split('?')[0]}: ${json?.message ?? r.status}`)
  if (ttl) cache.set(id, { at: Date.now(), value: json.result })
  return json.result
}

/** The chain this deployment reads, and how far it has got. */
export const chainStatus = () => request<{ chainID: number; blockNumber: number }>('GET', '/chains/ethereum/status', undefined, { ttlMs: 30_000 })

/** Native ETH balance, in wei, via the address book lookup. */
export async function ethBalance(address: string): Promise<bigint> {
  const r = await request<{ balance?: string }>('GET', `/chains/ethereum/addresses/${address}?include=balance`)
  return BigInt(r.balance ?? '0')
}

/**
 * Call a view function. `contract` is a label in MultiBaas (its ABI); with
 * `override`, the address need not be linked to that contract first.
 * MultiBaas formats integers using the ABI's decimals where it knows them.
 */
export async function call<T = unknown>(address: string, contract: string, method: string, args: unknown[] = [], opts: { override?: boolean } = {}): Promise<T> {
  const r = await request<{ output: T }>('POST', `/chains/ethereum/addresses/${address}/contracts/${contract}/methods/${method}`, {
    args, ...(opts.override !== false ? { contractOverride: true } : {}), formatInts: 'as_strings',
  })
  return r.output
}

/** An ERC-20 balance in whole units (MultiBaas applies `decimals`). */
export const tokenBalance = async (token: string, holder: string): Promise<number> => Number(await call<string>(token, 'erc20interface', 'balanceOf', [holder]))

// ---- setup: address book, contracts, links, event queries --------------------

/** Label an address in the address book, so calls and events can use the alias. */
export const setAlias = (alias: string, address: string) => request('POST', '/chains/ethereum/addresses', { alias, address })

/** Upload a contract ABI under a label. */
export const createContract = (label: string, contractName: string, rawAbi: string, version = '1.0') =>
  request('POST', `/contracts/${label}`, { label, contractName, version, rawAbi })

/** Link an address to a contract; with `startingBlock`, its events are indexed from there on. */
export const linkContract = (addressOrAlias: string, label: string, startingBlock?: string) =>
  request('POST', `/chains/ethereum/addresses/${addressOrAlias}/contracts`, { label, ...(startingBlock ? { startingBlock } : {}) })

export const indexingStatus = (addressOrAlias: string, label: string) =>
  request<{ isProcessingPastLogs: boolean; latestBlockNumber: number; startBlockNumber: number }>('GET', `/chains/ethereum/addresses/${addressOrAlias}/contracts/${label}/status`, undefined, { ttlMs: 30_000 })

export type EventQuery = { events: { eventName: string; select: { type: string; name?: string; alias?: string; aggregator?: string }[]; filter?: unknown }[]; groupBy?: string; orderBy?: string; order?: 'ASC' | 'DESC' }
export const saveEventQuery = (label: string, query: EventQuery) => request('PUT', `/queries/${label}`, query)
export const eventQueryResults = <Row = Record<string, unknown>>(label: string) =>
  request<{ rows: Row[] }>('GET', `/queries/${label}/results`).then((r) => r.rows ?? [])

/** Indexed events, newest first; filter by contract address or label. */
export type IndexedEvent = { triggeredAt: string; event: { name: string; signature: string; inputs: { name: string; value: unknown }[] }; transaction: { txHash: string; blockNumber: number }; contract: { address: string; label: string; name: string } }
export const listEvents = (opts: { contractAddress?: string; contractLabel?: string; eventSignature?: string; limit?: number } = {}) => {
  const qs = new URLSearchParams({ limit: String(opts.limit ?? 50) })
  if (opts.contractAddress) qs.set('contract_address', opts.contractAddress)
  if (opts.contractLabel) qs.set('contract_label', opts.contractLabel)
  if (opts.eventSignature) qs.set('event_signature', opts.eventSignature)
  return request<IndexedEvent[]>('GET', `/events?${qs}`, undefined, { ttlMs: 60_000 })
}
