/**
 * A wallet on Base, read as patterns.
 *
 * The wallet a person signed in with is already proven theirs, so this source
 * needs no OAuth and no key of theirs. It reads that address on Base mainnet:
 *
 *   - balances through MultiBaas — ETH from its address book, each token by
 *     calling `balanceOf` on its built-in ERC-20 interface, the same reads the
 *     Portfolio Intelligence demo makes (MULTIBAAS_URL, MULTIBAAS_API_KEY);
 *     through Base Blockscout's token list when MultiBaas is not configured
 *   - which named contracts it calls, from Base Blockscout (free, keyless)
 *   - prices from DefiLlama, so dust and airdrops are not called holdings
 *
 * What it writes — the same bar as every other source, patterns not contents:
 * that you hold ETH and which tokens you hold most of, which protocols you use
 * repeatedly, and whether you are active. Never an amount, a counterparty or a
 * transaction's contents. It never signs or sends anything.
 *
 * Kept under the id `ethereum` so existing grants carry over; the chain it reads
 * is Base.
 */
import { POLICY } from './policy.js'
import type { Finding } from './local-sources.js'

const BLOCKSCOUT = () => (process.env.BASE_BLOCKSCOUT_URL?.trim() || 'https://base.blockscout.com').replace(/\/+$/, '')

/** Tokens worth naming on Base — each is one MultiBaas call per wallet, so the list stays short. */
const TOKENS: { symbol: string; address: string }[] = [
  { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
  { symbol: 'WETH', address: '0x4200000000000000000000000000000000000006' },
  { symbol: 'cbBTC', address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf' },
  { symbol: 'cbETH', address: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22' },
  { symbol: 'wstETH', address: '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452' },
  { symbol: 'EURC', address: '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42' },
  { symbol: 'AERO', address: '0x940181a94A35A4569E4529A3CDfB74e38FD98631' },
  { symbol: 'VIRTUAL', address: '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b' },
  { symbol: 'DEGEN', address: '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed' },
]

type Tx = { timestamp: string; to?: { hash: string; name?: string | null; is_contract?: boolean } | null; result?: string }

// ---- MultiBaas: one deployment bound to Base --------------------------------

const multibaas = () => {
  const url = process.env.MULTIBAAS_URL?.trim().replace(/\/+$/, '')
  const key = process.env.MULTIBAAS_API_KEY?.trim().replace(/^=+/, '')
  return url && key ? { url: `${url}/api/v0`, key } : null
}

async function mb<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const m = multibaas()!
  const r = await fetch(`${m.url}${path}`, {
    method, headers: { authorization: `Bearer ${m.key}`, 'content-type': 'application/json', accept: 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20_000),
  })
  const json = (await r.json().catch(() => null)) as { status: number; message: string; result: T } | null
  if (!r.ok || !json || json.status !== 200) throw new Error(`MultiBaas ${path.split('?')[0]}: ${json?.message ?? r.status}`)
  return json.result
}

async function balancesViaMultiBaas(address: string): Promise<{ eth: number; units: Record<string, number> }> {
  const a = address.toLowerCase() // MultiBaas accepts lowercase whatever the checksum
  const [info, ...bal] = await Promise.all([
    mb<{ balance?: string }>('GET', `/chains/ethereum/addresses/${a}?include=balance`),
    ...TOKENS.map((t) => mb<{ output: string }>('POST', `/chains/ethereum/addresses/${t.address.toLowerCase()}/contracts/erc20interface/methods/balanceOf`, { args: [a], contractOverride: true, formatInts: 'as_strings' })
      .then((r) => Number(r.output)).catch(() => 0)),
  ])
  return { eth: Number(BigInt(info.balance ?? '0')) / 1e18, units: Object.fromEntries(TOKENS.map((t, i) => [t.symbol, bal[i] ?? 0])) }
}

// ---- Blockscout (Base): the fallback for balances, and activity --------------

async function bs<T>(path: string): Promise<T> {
  const r = await fetch(`${BLOCKSCOUT()}${path}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20_000) })
  if (r.status === 404) throw new Error('this address has no activity on Base')
  if (!r.ok) throw new Error(`Base Blockscout answered ${r.status}`)
  return r.json() as Promise<T>
}

async function balancesViaBlockscout(address: string): Promise<{ eth: number; units: Record<string, number> }> {
  const [info, list] = await Promise.all([
    bs<{ coin_balance?: string | null }>(`/api/v2/addresses/${address}`),
    bs<{ value: string; token: { address_hash?: string; address?: string; decimals?: string | null } }[]>(`/api/v2/addresses/${address}/token-balances`).catch(() => []),
  ])
  const units: Record<string, number> = {}
  for (const t of TOKENS) {
    const hit = list.find((b) => (b.token.address_hash ?? b.token.address ?? '').toLowerCase() === t.address.toLowerCase())
    units[t.symbol] = hit ? Number(hit.value) / 10 ** Number(hit.token.decimals ?? 18) : 0
  }
  return { eth: Number(info.coin_balance ?? 0) / 1e18, units }
}

async function usdPrices(): Promise<{ eth: number; tokens: Record<string, number> }> {
  const keys = ['coingecko:ethereum', ...TOKENS.map((t) => `base:${t.address}`)]
  const r = await fetch(`https://coins.llama.fi/prices/current/${keys.join(',')}`, { signal: AbortSignal.timeout(15_000) })
  if (!r.ok) throw new Error(`DefiLlama answered ${r.status}`)
  const coins = ((await r.json()) as { coins: Record<string, { price: number }> }).coins
  const tokens: Record<string, number> = {}
  for (const t of TOKENS) {
    const hit = Object.entries(coins).find(([k]) => k.toLowerCase() === `base:${t.address.toLowerCase()}`)
    if (hit) tokens[t.symbol] = hit[1].price
  }
  return { eth: coins['coingecko:ethereum']?.price ?? 0, tokens }
}

export type WalletActivity = {
  address: string
  eth: number
  tokens: { symbol: string; usd: number }[]
  txs: Tx[]
  /** Where the balances came from, for the claim's evidence. */
  via: 'MultiBaas' | 'Blockscout'
}

/** The address's balance and tokens on Base, and its recent outgoing transactions. */
export async function walletActivity(address: string): Promise<WalletActivity> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('not an Ethereum address')
  const p = POLICY.ethereum
  const via = multibaas() ? 'MultiBaas' as const : 'Blockscout' as const
  const [bal, px] = await Promise.all([
    via === 'MultiBaas' ? balancesViaMultiBaas(address) : balancesViaBlockscout(address),
    usdPrices().catch(() => ({ eth: 0, tokens: {} as Record<string, number> })),
  ])
  const tokens = TOKENS
    .map((t) => ({ symbol: t.symbol, usd: (bal.units[t.symbol] ?? 0) * (px.tokens[t.symbol] ?? 0) }))
    .filter((t) => t.usd >= p.minTokenUsd)
    .sort((a, b) => b.usd - a.usd)

  // Outgoing transactions in the window, newest first, a few pages at most.
  const since = Date.now() - p.windowDays * 86_400_000
  const txs: Tx[] = []
  let next: Record<string, string> | null = null
  for (let page = 0; page < p.pages; page++) {
    const qs: URLSearchParams = new URLSearchParams({ filter: 'from', ...(next ?? {}) })
    const res: { items: Tx[]; next_page_params: Record<string, string> | null } = await bs<{ items: Tx[]; next_page_params: Record<string, string> | null }>(`/api/v2/addresses/${address}/transactions?${qs}`)
      .catch(() => ({ items: [] as Tx[], next_page_params: null }))
    for (const t of res.items) if (Date.parse(t.timestamp) >= since) txs.push(t)
    const oldest = res.items[res.items.length - 1]
    if (!res.next_page_params || !oldest || Date.parse(oldest.timestamp) < since) break
    next = res.next_page_params
  }
  return { address, eth: bal.eth, tokens, txs, via }
}

/**
 * What a person would call a contract. Explorers show deployment names —
 * "UniversalRouter", "Pool" — which describe code, not the protocol someone
 * thinks they used.
 */
const ALIASES: [RegExp, string][] = [
  [/uniswap|swaprouter|universalrouter|permit2/i, 'Uniswap'],
  [/aerodrome|velodrome/i, 'Aerodrome'],
  [/morpho/i, 'Morpho'],
  [/moonwell|mtoken/i, 'Moonwell'],
  [/aave|lendingpool/i, 'Aave'],
  [/l2standardbridge|bridge/i, 'the Base bridge'],
  [/publicresolver|ethregistrar|registrarcontroller|l2resolver/i, 'Basenames'],
  [/gnosissafe|safeproxy|^safe\b/i, 'Safe'],
  [/^weth\d*$/i, 'WETH'],
  [/1inch|aggregationrouter/i, '1inch'],
  [/curve/i, 'Curve'],
  [/opensea|seaport/i, 'OpenSea'],
  [/zora/i, 'Zora'],
]
function protocolName(raw: string): string {
  for (const [re, name] of ALIASES) if (re.test(raw)) return name
  return raw
    .replace(/\s*[:(].*$/, '')
    .replace(/(V\d+|Router\d*|Proxy|Portal|Implementation)/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s{2,}/g, ' ')
    .trim() || raw
}

export function findings(a: WalletActivity): Finding[] {
  const p = POLICY.ethereum
  const out: Finding[] = []
  const window = `in the last ${p.windowDays} days`

  if (a.eth >= p.minEth) {
    out.push({ text: 'Holds ETH on Base', topic: 'portfolio', evidence: `balance on Base, read through ${a.via}`, ref: a.address })
  }
  for (const t of a.tokens.slice(0, p.keepTokens)) {
    out.push({ text: `Holds ${t.symbol} on Base`, topic: 'portfolio', evidence: `token balance on Base, read through ${a.via}`, ref: a.address })
  }

  // Protocols: named contracts this wallet called at least `minInteractions` times.
  const byProtocol = new Map<string, number>()
  for (const t of a.txs) {
    if (t.result && t.result !== 'success') continue
    const name = t.to?.is_contract && t.to.name ? protocolName(t.to.name) : null
    if (name) byProtocol.set(name, (byProtocol.get(name) ?? 0) + 1)
  }
  ;[...byProtocol.entries()]
    .filter(([, n]) => n >= p.minInteractions)
    .sort((x, y) => y[1] - x[1])
    .slice(0, p.keepProtocols)
    .forEach(([name, n]) => out.push({ text: `Uses ${name} on Base`, topic: 'portfolio', evidence: `${n} transactions ${window}`, ref: a.address }))

  if (a.txs.length >= p.minActive) {
    out.push({ text: 'Is active on Base', topic: 'portfolio', evidence: `${a.txs.length} transactions ${window}`, ref: a.address })
  }
  return out
}
