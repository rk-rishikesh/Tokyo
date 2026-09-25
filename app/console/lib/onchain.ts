/**
 * Wallets, read in full, for the on-chain agents demo.
 *
 * The connect source (app/connect/src/ethereum.ts) deliberately writes only
 * patterns — "Holds USDC", never a balance — because what it writes becomes a
 * claim other agents may read. This is the other case: the person is looking at
 * their own wallets, on their own screen, and a treasury agent that cannot see
 * amounts cannot say whether payroll is covered. Nothing here is written
 * anywhere; it is read, shown and discarded.
 *
 * Ethereum mainnet through Blockscout's public API (keyless), and ENS names
 * resolved on mainnet, because that is where people's wallets actually are.
 */
import { createPublicClient, getAddress, http } from 'viem'
import { mainnet } from 'viem/chains'
import { normalize } from 'viem/ens'

const BASE = () => (process.env.ETH_BLOCKSCOUT_URL?.trim() || 'https://eth.blockscout.com').replace(/\/+$/, '')
const MAINNET_RPC = () => process.env.MAINNET_RPC_URL?.trim() || 'https://ethereum-rpc.publicnode.com'

/**
 * Below this, a priced token is almost always an airdrop, not a holding. Well
 * known wallets are showered with priced memecoins in the $1–20M range, and a
 * treasury view led by them says nothing true.
 */
const MIN_MARKET_CAP_USD = 25_000_000
const MIN_HOLDING_USD = 1

export const STABLECOINS = new Set(['USDC', 'USDT', 'DAI', 'USDS', 'PYUSD', 'FRAX', 'GHO', 'LUSD', 'USDE', 'CRVUSD', 'RLUSD', 'FDUSD', 'TUSD'])

export type Holding = { symbol: string; name: string; units: number; price: number; usd: number; stable: boolean }
export type Movement = {
  at: string
  hash: string
  direction: 'in' | 'out' | 'self'
  asset: string
  units: number
  usd: number | null
  counterparty: string
  counterpartyName: string | null
  method: string | null
  ok: boolean
  feeEth: number
}
export type Wallet = {
  input: string
  address: string
  ens: string | null
  holdings: Holding[]
  totalUsd: number
  ethUnits: number
  movements: Movement[]
}

type Party = { hash: string; name?: string | null; ens_domain_name?: string | null; is_contract?: boolean } | null
type Tx = { hash: string; timestamp: string; value: string; fee?: { value?: string } | null; method?: string | null; result?: string; status?: string; from: Party; to: Party }
type Transfer = { transaction_hash: string; timestamp: string; method?: string | null; from: Party; to: Party; total?: { value?: string; decimals?: string | null } | null; token: { symbol?: string | null; decimals?: string | null; exchange_rate?: string | null; circulating_market_cap?: string | null; reputation?: string | null } }
type TokenRow = { value: string; token: { symbol?: string | null; name?: string | null; type?: string; decimals?: string | null; exchange_rate?: string | null; circulating_market_cap?: string | null; reputation?: string | null } }

async function get<T>(path: string, attempt = 0): Promise<T> {
  try {
    const r = await fetch(`${BASE()}${path}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(25_000), next: { revalidate: 60 } })
    if (r.status === 404) throw new Error('no activity on Ethereum mainnet')
    // The public API rate-limits bursts; one patient retry is usually enough.
    if ((r.status === 429 || r.status >= 500) && attempt < 1) { await new Promise((res) => setTimeout(res, 1500)); return get<T>(path, attempt + 1) }
    if (!r.ok) throw new Error(`Blockscout answered ${r.status}`)
    return r.json() as Promise<T>
  } catch (e) {
    if (attempt < 1 && e instanceof Error && e.name === 'TimeoutError') return get<T>(path, attempt + 1)
    throw e
  }
}

/** An address, or an ENS name resolved on mainnet. */
export async function resolveInput(input: string): Promise<{ address: string; ens: string | null }> {
  const raw = input.trim()
  if (/^0x[0-9a-fA-F]{40}$/.test(raw)) return { address: getAddress(raw), ens: null }
  if (/^[^\s]+\.eth$/i.test(raw)) {
    const client = createPublicClient({ chain: mainnet, transport: http(MAINNET_RPC()) })
    const address = await client.getEnsAddress({ name: normalize(raw) }).catch(() => null)
    if (!address) throw new Error(`${raw} does not resolve to an address on mainnet`)
    return { address: getAddress(address), ens: raw.toLowerCase() }
  }
  throw new Error('enter an address (0x…) or an ENS name (name.eth)')
}

const units = (value: string | undefined | null, decimals: string | number | null | undefined) => Number(value ?? 0) / 10 ** Number(decimals ?? 18)
const nameOf = (p: Party) => p?.ens_domain_name ?? p?.name ?? null
const genuine = (t: { exchange_rate?: string | null; circulating_market_cap?: string | null; reputation?: string | null; symbol?: string | null }) =>
  !!t.exchange_rate && !!t.symbol && Number(t.circulating_market_cap ?? 0) >= MIN_MARKET_CAP_USD && !/scam|spam/i.test(t.reputation ?? '')

export async function readWallet(input: string): Promise<Wallet> {
  const { address, ens } = await resolveInput(input)
  const [info, stats, balances, txs, transfers] = await Promise.all([
    get<{ coin_balance?: string | null; exchange_rate?: string | null; ens_domain_name?: string | null }>(`/api/v2/addresses/${address}`),
    get<{ coin_price?: string | null }>(`/api/v2/stats`).catch(() => ({ coin_price: null })),
    // The paginated list, highest fiat value first. The unpaginated
    // token-balances endpoint returns every airdrop ever received — megabytes,
    // and tens of seconds, for a well-known wallet.
    get<{ items: TokenRow[] }>(`/api/v2/addresses/${address}/tokens?type=ERC-20`).then((r) => r.items).catch(() => [] as TokenRow[]),
    get<{ items: Tx[] }>(`/api/v2/addresses/${address}/transactions`).catch(() => ({ items: [] as Tx[] })),
    get<{ items: Transfer[] }>(`/api/v2/addresses/${address}/token-transfers?type=ERC-20`).catch(() => ({ items: [] as Transfer[] })),
  ])
  const ethPrice = Number(info.exchange_rate ?? stats.coin_price ?? 0)
  const ethUnits = units(info.coin_balance, 18)
  const me = address.toLowerCase()

  const holdings: Holding[] = [
    { symbol: 'ETH', name: 'Ether', units: ethUnits, price: ethPrice, usd: ethUnits * ethPrice, stable: false },
    ...balances
      .filter((b) => genuine(b.token))
      .map((b) => {
        const u = units(b.value, b.token.decimals)
        const symbol = b.token.symbol!.trim()
        return { symbol, name: b.token.name?.trim() || symbol, units: u, price: Number(b.token.exchange_rate), usd: u * Number(b.token.exchange_rate), stable: STABLECOINS.has(symbol.toUpperCase()) }
      }),
  ]
    .filter((h) => h.usd >= MIN_HOLDING_USD || (h.symbol === 'ETH' && h.units > 0))
    .sort((a, b) => b.usd - a.usd)

  const direction = (from: Party, to: Party): Movement['direction'] => {
    const f = from?.hash?.toLowerCase(), t = to?.hash?.toLowerCase()
    return f === me && t === me ? 'self' : f === me ? 'out' : 'in'
  }
  const movements: Movement[] = [
    ...txs.items.map((t) => {
      const dir = direction(t.from, t.to)
      const other = dir === 'out' ? t.to : t.from
      const u = units(t.value, 18)
      return {
        at: t.timestamp, hash: t.hash, direction: dir, asset: 'ETH', units: u, usd: ethPrice ? u * ethPrice : null,
        counterparty: other?.hash ?? '', counterpartyName: nameOf(other), method: t.method ?? null,
        ok: (t.result ?? t.status) === 'success' || t.status === 'ok', feeEth: dir === 'out' ? units(t.fee?.value, 18) : 0,
      }
    }),
    ...transfers.items.filter((t) => genuine(t.token)).map((t) => {
      const dir = direction(t.from, t.to)
      const other = dir === 'out' ? t.to : t.from
      const u = units(t.total?.value, t.total?.decimals ?? t.token.decimals)
      return {
        at: t.timestamp, hash: t.transaction_hash, direction: dir, asset: t.token.symbol!.trim(), units: u, usd: u * Number(t.token.exchange_rate),
        counterparty: other?.hash ?? '', counterpartyName: nameOf(other), method: t.method ?? null, ok: true, feeEth: 0,
      }
    }),
  ]
    // A plain contract call with no value moved is not a movement of funds, and
    // incoming dust is how address-poisoning spam arrives.
    .filter((m) => (m.units > 0 || !m.ok) && !(m.direction === 'in' && m.usd !== null && m.usd < 1))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 60)

  return {
    input, address, ens: ens ?? info.ens_domain_name ?? null,
    holdings, totalUsd: holdings.reduce((n, h) => n + h.usd, 0), ethUnits, movements,
  }
}
