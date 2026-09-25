/**
 * Wallets on Base mainnet, read through MultiBaas.
 *
 * ETH from the address book lookup, tokens by calling `balanceOf` on
 * MultiBaas's built-in ERC-20 ABI, priced from CoinGecko. The token list is
 * fixed and short on purpose: each (wallet, token) pair is one API call.
 */
import { ethBalance, tokenBalance } from './multibaas'

export type BaseToken = { symbol: string; address: string; coingecko: string; stable?: boolean }

export const BASE_TOKENS: BaseToken[] = [
  { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', coingecko: 'usd-coin', stable: true },
  { symbol: 'WETH', address: '0x4200000000000000000000000000000000000006', coingecko: 'weth' },
  { symbol: 'cbBTC', address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', coingecko: 'coinbase-wrapped-btc' },
  { symbol: 'cbETH', address: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22', coingecko: 'coinbase-wrapped-staked-eth' },
  { symbol: 'AERO', address: '0x940181a94A35A4569E4529A3CDfB74e38FD98631', coingecko: 'aerodrome-finance' },
]

export type Holding = { symbol: string; units: number; usd: number; stable: boolean }
export type BaseWallet = { label: string; address: string; holdings: Holding[]; totalUsd: number; ethUnits: number }

let priceCache: { at: number; prices: Record<string, number> } | null = null

export async function prices(): Promise<Record<string, number>> {
  if (priceCache && Date.now() - priceCache.at < 5 * 60_000) return priceCache.prices
  const ids = ['ethereum', ...BASE_TOKENS.map((t) => t.coingecko)].join(',')
  const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`, { signal: AbortSignal.timeout(15_000), cache: 'no-store' })
  if (!r.ok) throw new Error(`CoinGecko answered ${r.status}`)
  const body = (await r.json()) as Record<string, { usd: number }>
  const out: Record<string, number> = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, v.usd]))
  priceCache = { at: Date.now(), prices: out }
  return out
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
    ...BASE_TOKENS.map((t, i) => ({ symbol: t.symbol, units: balances[i] ?? 0, usd: (balances[i] ?? 0) * (p[t.coingecko] ?? 0), stable: !!t.stable })),
    // Dust is not a holding.
  ].filter((h) => h.usd >= 1 || (h.symbol === 'ETH' && h.units > 0)).sort((a, b) => b.usd - a.usd)
  return { label, address, holdings, totalUsd: holdings.reduce((n, h) => n + h.usd, 0), ethUnits }
}
