/**
 * Actions to take, derived from a wallet and the playbook in treasury.eth.
 *
 * The thresholds are read out of the playbook's claims ("under 50%", "0.05
 * ETH"), so changing a policy in memory changes the dashboard — the numbers are
 * not hard-coded here. Each action names the claim it came from.
 */
import type { BaseWallet } from './basePortfolio'
import type { Claim } from './treasuryAgent'

export type Action = { level: 'act' | 'watch' | 'ok'; title: string; detail: string; source: string; kind: 'rebalance' | 'gas' | 'reserve' | 'vote' | 'vesting' }

export type Playbook = { maxAssetPct: number; minGasEth: number; runwayMonths: number; outflowPct: number; sources: Record<string, string> }

const num = (s: string | undefined, re: RegExp, fallback: number) => { const m = s?.match(re); return m ? Number(m[1]) : fallback }

export function playbookFrom(claims: Claim[]): Playbook {
  const policy = claims.filter((c) => c.topic === 'policy')
  const by = (subject: string) => policy.find((c) => c.subject === subject)
  const conc = by('Concentration limit'), gas = by('Gas reserve'), run = by('Runway'), out = by('Outflow alert')
  return {
    maxAssetPct: num(conc?.claim, /(\d+(?:\.\d+)?)%/, 50),
    minGasEth: num(gas?.claim, /(\d+(?:\.\d+)?)\s*ETH/i, 0.05),
    runwayMonths: num(run?.claim, /(\d+)\s*months?/i, 12),
    outflowPct: num(out?.claim, /(\d+(?:\.\d+)?)%/, 5),
    sources: { concentration: conc?.id ?? '', gas: gas?.id ?? '', runway: run?.id ?? '', outflow: out?.id ?? '' },
  }
}

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

export function walletActions(w: BaseWallet, p: Playbook, peers: { stablePct: number }[] = []): Action[] {
  const out: Action[] = []
  const total = w.totalUsd
  if (!total) return [{ level: 'watch', kind: 'reserve', title: 'Nothing priced in this wallet on Base', detail: 'No ETH or listed tokens were found.', source: 'MultiBaas' }]

  // Concentration: one exposure per asset family (ETH + WETH).
  const volatile = new Map<string, number>()
  for (const h of w.holdings.filter((x) => !x.stable)) { const k = h.symbol === 'WETH' ? 'ETH' : h.symbol; volatile.set(k, (volatile.get(k) ?? 0) + h.usd) }
  const [topSym, topUsd] = [...volatile.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['', 0]
  const topPct = (topUsd / total) * 100
  if (topSym && topPct > p.maxAssetPct) {
    const excess = ((topPct - p.maxAssetPct) / 100) * total
    out.push({ level: 'act', kind: 'rebalance', title: `Rebalance ${usd(excess)} out of ${topSym}`, detail: `${topSym} is ${topPct.toFixed(0)}% of this wallet; the playbook caps any one asset at ${p.maxAssetPct}%.`, source: 'treasury.eth · Concentration limit' })
  } else if (topSym) {
    out.push({ level: 'ok', kind: 'rebalance', title: `${topSym} at ${topPct.toFixed(0)}% — within the cap`, detail: `The playbook caps any one asset at ${p.maxAssetPct}%.`, source: 'treasury.eth · Concentration limit' })
  }

  // Gas: the wallet can still move.
  if (w.ethUnits < p.minGasEth) {
    out.push({ level: 'act', kind: 'gas', title: `Top up ${(p.minGasEth - w.ethUnits).toFixed(4)} ETH for gas`, detail: `Holds ${w.ethUnits.toFixed(4)} ETH on Base; the playbook keeps ${p.minGasEth} ETH per wallet.`, source: 'treasury.eth · Gas reserve' })
  }

  // Reserve: stablecoin share against the watched treasuries.
  const stable = w.holdings.filter((h) => h.stable).reduce((n, h) => n + h.usd, 0)
  const stablePct = (stable / total) * 100
  if (peers.length) {
    const s = peers.map((x) => x.stablePct).sort((a, b) => a - b)
    const median = s[Math.floor(s.length / 2)]!
    out.push({
      level: stablePct < median / 2 ? 'watch' : 'ok', kind: 'reserve',
      title: `${stablePct.toFixed(0)}% in stablecoins`,
      detail: `Watched treasuries hold a median ${median.toFixed(0)}%. The playbook wants ${p.runwayMonths} months of spend in stablecoins — ask Agent B with your monthly spend.`,
      source: 'treasury.eth · Runway · benchmarks',
    })
  }
  return out
}
