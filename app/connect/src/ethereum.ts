/**
 * An Ethereum wallet, read as patterns.
 *
 * The wallet a person signed in with is already proven theirs, so this source
 * needs no OAuth and no key: it reads that address's public activity on
 * Ethereum mainnet through Blockscout's public API (free, keyless). Chain data
 * is public to anyone; what this adds is turning it into claims under the
 * person's own name, sourced to the chain.
 *
 * What it writes — the same bar as every other source, patterns not contents:
 *
 *   - that you hold ETH, and which priced tokens you hold (the top few)
 *   - which named contracts you use repeatedly ("Uses Uniswap on Ethereum")
 *   - whether you are active, and how much
 *
 * What it never writes: an amount, a counterparty, a transaction's contents.
 * "Holds USDC" is useful to an agent planning for you; a balance is not
 * something every agent you grant should see. It never signs or sends anything.
 *
 * Tokens below a real market cap are skipped: most tokens in a wallet are
 * airdropped, many of them priced, and "Holds MOODENG" is not knowledge.
 */
import { POLICY } from './policy.js'
import type { Finding } from './local-sources.js'

const BASE = () => (process.env.ETH_BLOCKSCOUT_URL?.trim() || 'https://eth.blockscout.com').replace(/\/+$/, '')

type AddressInfo = { coin_balance?: string | null; is_contract?: boolean }
type TokenBalance = { value: string; token: { symbol?: string | null; name?: string | null; type?: string; decimals?: string | null; exchange_rate?: string | null; circulating_market_cap?: string | null; reputation?: string | null } }
type Tx = { timestamp: string; from?: { hash: string }; to?: { hash: string; name?: string | null; is_contract?: boolean } | null; method?: string | null; result?: string }

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE()}${path}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20_000) })
  if (r.status === 404) throw new Error('this address has no activity on Ethereum mainnet')
  if (!r.ok) throw new Error(`Blockscout answered ${r.status}`)
  return r.json() as Promise<T>
}

export type WalletActivity = {
  address: string
  eth: number
  tokens: { symbol: string; usd: number }[]
  txs: Tx[]
}

/** The address's balance, priced tokens, and recent outgoing transactions. */
export async function walletActivity(address: string): Promise<WalletActivity> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('not an Ethereum address')
  const p = POLICY.ethereum
  const [info, balances] = await Promise.all([
    get<AddressInfo>(`/api/v2/addresses/${address}`),
    get<TokenBalance[]>(`/api/v2/addresses/${address}/token-balances`).catch(() => [] as TokenBalance[]),
  ])

  const tokens = balances
    // A price alone is not enough: airdropped memecoins are priced too. A real
    // market cap, and not flagged by the explorer, is what makes a holding.
    .filter((b) => b.token.type === 'ERC-20' && b.token.exchange_rate && b.token.symbol
      && Number(b.token.circulating_market_cap ?? 0) >= p.minMarketCapUsd
      && !/scam|spam/i.test(b.token.reputation ?? ''))
    .map((b) => {
      const units = Number(b.value) / 10 ** Number(b.token.decimals ?? 18)
      return { symbol: b.token.symbol!.trim(), usd: units * Number(b.token.exchange_rate) }
    })
    .filter((t) => t.usd >= p.minTokenUsd)
    .sort((a, b) => b.usd - a.usd)

  // Outgoing transactions in the window, newest first, a few pages at most.
  const since = Date.now() - p.windowDays * 86_400_000
  const txs: Tx[] = []
  let next: Record<string, string> | null = null
  for (let page = 0; page < p.pages; page++) {
    const qs: URLSearchParams = new URLSearchParams({ filter: 'from', ...(next ?? {}) })
    const res: { items: Tx[]; next_page_params: Record<string, string> | null } = await get<{ items: Tx[]; next_page_params: Record<string, string> | null }>(`/api/v2/addresses/${address}/transactions?${qs}`)
    for (const t of res.items) if (Date.parse(t.timestamp) >= since) txs.push(t)
    const oldest = res.items[res.items.length - 1]
    if (!res.next_page_params || !oldest || Date.parse(oldest.timestamp) < since) break
    next = res.next_page_params
  }

  return { address, eth: Number(info.coin_balance ?? 0) / 1e18, tokens, txs }
}

/**
 * What a person would call a contract. Explorers show deployment names —
 * "UniswapV2Router02", "PublicResolver" — which describe code, not the
 * protocol someone thinks they used.
 */
const ALIASES: [RegExp, string][] = [
  [/uniswap|swaprouter|universalrouter|permit2/i, 'Uniswap'],
  [/publicresolver|ethregistrar|ensregistry|namewrapper|reverseregistrar/i, 'ENS'],
  [/gnosissafe|safeproxy|^safe\b/i, 'Safe'],
  [/^weth\d*$/i, 'WETH'],
  [/lido|steth/i, 'Lido'],
  [/aave|lendingpool/i, 'Aave'],
  [/1inch|aggregationrouter/i, '1inch'],
  [/curve/i, 'Curve'],
  [/opensea|seaport/i, 'OpenSea'],
  [/compound|comet/i, 'Compound'],
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
    out.push({ text: 'Holds ETH on Ethereum', topic: 'portfolio', evidence: 'balance on Ethereum mainnet', ref: a.address })
  }
  for (const t of a.tokens.slice(0, p.keepTokens)) {
    out.push({ text: `Holds ${t.symbol} on Ethereum`, topic: 'portfolio', evidence: 'token balance on Ethereum mainnet', ref: a.address })
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
    .forEach(([name, n]) => out.push({ text: `Uses ${name} on Ethereum`, topic: 'portfolio', evidence: `${n} transactions ${window}`, ref: a.address }))

  if (a.txs.length >= p.minActive) {
    out.push({ text: 'Is active on Ethereum', topic: 'portfolio', evidence: `${a.txs.length} transactions ${window}`, ref: a.address })
  }
  return out
}
