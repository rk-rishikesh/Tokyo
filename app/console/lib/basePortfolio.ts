/**
 * Wallets on Base mainnet, read through MultiBaas.
 *
 * ETH from the address book lookup, tokens by calling `balanceOf` on
 * MultiBaas's built-in ERC-20 ABI, priced from DefiLlama. The token list is
 * fixed and short on purpose: each (wallet, token) pair is one API call.
 */
import { ethBalance, tokenBalance } from './multibaas'

export type BaseToken = { symbol: string; address: string; coingecko: string; stable?: boolean; yieldBearing?: boolean }

export const BASE_TOKENS: BaseToken[] = [
  { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', coingecko: 'usd-coin', stable: true },
  { symbol: 'WETH', address: '0x4200000000000000000000000000000000000006', coingecko: 'weth' },
  { symbol: 'cbBTC', address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', coingecko: 'coinbase-wrapped-btc' },
  { symbol: 'cbETH', address: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22', coingecko: 'coinbase-wrapped-staked-eth', yieldBearing: true },
  { symbol: 'wstETH', address: '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452', coingecko: 'wrapped-steth', yieldBearing: true },
  { symbol: 'EURC', address: '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42', coingecko: 'euro-coin', stable: true },
  { symbol: 'AERO', address: '0x940181a94A35A4569E4529A3CDfB74e38FD98631', coingecko: 'aerodrome-finance' },
  { symbol: 'VIRTUAL', address: '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b', coingecko: 'virtual-protocol' },
  { symbol: 'DEGEN', address: '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed', coingecko: 'degen-base' },
]

export type Holding = { symbol: string; units: number; usd: number; stable: boolean; yieldBearing?: boolean }
export type BaseWallet = { label: string; address: string; holdings: Holding[]; totalUsd: number; ethUnits: number }

let priceCache: { at: number; prices: Record<string, number> } | null = null
// Concurrent wallet reads share one request: the free price API rate-limits bursts.
let inflight: Promise<Record<string, number>> | null = null

/**
 * Prices keyed by CoinGecko id. DefiLlama first — keyless, generous limits,
 * and it prices Base tokens by contract address — then CoinGecko, whose free
 * tier rate-limits bursts.
 */
async function fetchPrices(): Promise<Record<string, number>> {
  try {
    const keys = ['coingecko:ethereum', ...BASE_TOKENS.map((t) => `base:${t.address}`)]
    const r = await fetch(`https://coins.llama.fi/prices/current/${keys.join(',')}`, { signal: AbortSignal.timeout(15_000), cache: 'no-store' })
    if (!r.ok) throw new Error(`DefiLlama answered ${r.status}`)
    const coins = ((await r.json()) as { coins: Record<string, { price: number }> }).coins
    const out: Record<string, number> = { ethereum: coins['coingecko:ethereum']?.price ?? 0 }
    for (const t of BASE_TOKENS) {
      const hit = Object.entries(coins).find(([k]) => k.toLowerCase() === `base:${t.address.toLowerCase()}`)
      if (hit) out[t.coingecko] = hit[1].price
    }
    if (out.ethereum) return out
  } catch { /* fall through to CoinGecko */ }
  const ids = ['ethereum', ...BASE_TOKENS.map((t) => t.coingecko)].join(',')
  const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`, { signal: AbortSignal.timeout(15_000), cache: 'no-store' })
  if (!r.ok) throw new Error(`no price source answered (CoinGecko ${r.status})`)
  const body = (await r.json()) as Record<string, { usd: number }>
  return Object.fromEntries(Object.entries(body).map(([k, v]) => [k, v.usd]))
}

export async function prices(): Promise<Record<string, number>> {
  if (priceCache && Date.now() - priceCache.at < 5 * 60_000) return priceCache.prices
  inflight ??= fetchPrices()
    .then((p) => { priceCache = { at: Date.now(), prices: p }; return p })
    // A stale price beats no dashboard.
    .catch((e) => { if (priceCache) return priceCache.prices; throw e })
    .finally(() => { inflight = null })
  return inflight
}

export async function readBaseWallet(label: string, address: string): Promise<BaseWallet> {
  const p = await prices()
  const [wei, ...balances] = await Promise.all([
    ethBalance(address),
    ...BASE_TOKENS.map((t) => tokenBalance(t.address, address).catch(() => 0)),
  ])
  const ethUnits = Number(wei) / 1e18
  const holdings: Holding[] = [
    { symbol: 'ETH', units: ethUnits, usd: ethUnits * (p.ethereum ?? 0), stable: false },
    ...BASE_TOKENS.map((t, i) => ({ symbol: t.symbol, units: balances[i] ?? 0, usd: (balances[i] ?? 0) * (p[t.coingecko] ?? 0), stable: !!t.stable, ...(t.yieldBearing ? { yieldBearing: true } : {}) })),
    // Dust is not a holding.
  ].filter((h) => h.usd >= 1 || (h.symbol === 'ETH' && h.units > 0)).sort((a, b) => b.usd - a.usd)
  return { label, address, holdings, totalUsd: holdings.reduce((n, h) => n + h.usd, 0), ethUnits }
}
