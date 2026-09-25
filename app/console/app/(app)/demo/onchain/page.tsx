import Link from 'next/link'
import { FlowGraph, type GraphEdge, type GraphNode } from '@/components/motion/FlowGraph'
import { readBaseWallet, type BaseWallet } from '@/lib/basePortfolio'
import { DEMO_WALLET, WATCHED } from '@/lib/baseWatch'
import { playbookFrom, walletActions, type Action } from '@/lib/actions'
import { multibaasConfigured } from '@/lib/multibaas'
import { loadTreasury, TREASURY } from '@/lib/treasuryAgent'

export const metadata = { title: 'Demo — treasury dashboard' }
export const dynamic = 'force-dynamic'

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
/** One exposure per asset family: wrapped ether counts as ether. */
const largest = (w: BaseWallet) => {
  const m = new Map<string, number>()
  for (const h of w.holdings) { const k = h.symbol === 'WETH' ? 'ETH' : h.symbol; m.set(k, (m.get(k) ?? 0) + h.usd) }
  const top = [...m.entries()].sort((a, b) => b[1] - a[1])[0]
  return top && w.totalUsd ? { symbol: top[0], pct: (top[1] / w.totalUsd) * 100 } : null
}
const stablePct = (w: BaseWallet) => (w.totalUsd ? (w.holdings.filter((h) => h.stable).reduce((n, h) => n + h.usd, 0) / w.totalUsd) * 100 : 0)

export default async function TreasuryDashboard({ searchParams }: { searchParams: Promise<{ wallet?: string }> }) {
  const { wallet } = await searchParams
  const target = wallet && /^0x[0-9a-fA-F]{40}$/.test(wallet.trim()) ? { label: 'Your wallet', address: wallet.trim() } : DEMO_WALLET

  if (!multibaasConfigured()) {
    return <p className="rounded-2xl border border-dashed border-line p-8 text-dim">MultiBaas is not configured on this deployment (set MULTIBAAS_URL and MULTIBAAS_API_KEY).</p>
  }

  const [treasury, me, ...peers] = await Promise.all([
    loadTreasury(),
    readBaseWallet(target.label, target.address).catch(() => null),
    ...WATCHED.map((w) => readBaseWallet(w.label, w.address).catch(() => null)),
  ])
  const watched = peers.filter((p): p is BaseWallet => !!p)
  const playbook = playbookFrom(treasury?.claims ?? [])
  const actions: Action[] = me ? walletActions(me, playbook, watched.map((w) => ({ stablePct: stablePct(w) }))) : []

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[12px] uppercase tracking-[0.12em] text-dim">Treasury dashboard · Base mainnet · via MultiBaas</p>
          <h1 className="mt-2 text-[clamp(1.9rem,3.6vw,3rem)] font-semibold leading-[1.02] tracking-[-0.035em]">Know what you hold. Know what to do.</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form action="/demo/onchain" method="get" className="flex gap-2">
            <input name="wallet" defaultValue={wallet ?? ''} placeholder="Your Base wallet 0x…" spellCheck={false} className="w-[260px] rounded-xl border border-line bg-surface px-3 py-2 font-mono text-[13.5px] outline-none focus:border-ink/40" />
            <button className="rounded-xl border border-line px-4 py-2 text-[13.5px] hover:bg-raised">Load</button>
          </form>
          <Link href={`/demo/onchain/chat${wallet ? `?wallet=${wallet}` : ''}`} className="rounded-xl bg-ink px-4 py-2 text-[13.5px] text-bg hover:opacity-85">Ask Agent B →</Link>
        </div>
      </header>

      {!me ? (
        <p className="rounded-2xl border border-dashed border-line p-8 text-dim">Could not read {short(target.address)} through MultiBaas right now.</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label={target.label} value={usd(me.totalUsd)} hint={short(me.address)} />
            <Tile label="Stablecoins" value={`${stablePct(me).toFixed(0)}%`} hint={usd(me.holdings.filter((h) => h.stable).reduce((n, h) => n + h.usd, 0))} />
            <Tile label="Largest asset" value={largest(me)?.symbol ?? '—'} hint={largest(me) ? `${largest(me)!.pct.toFixed(0)}% of value${largest(me)!.symbol === 'ETH' ? ' incl. WETH' : ''}` : ''} />
            <Tile label="Actions" value={String(actions.filter((a) => a.level !== 'ok').length)} hint="from the playbook" />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr]">
            <Card title="Holdings" note="balanceOf via MultiBaas · priced by CoinGecko">
              <ul className="space-y-3">
                {me.holdings.map((h) => {
                  const pct = me.totalUsd ? (h.usd / me.totalUsd) * 100 : 0
                  return (
                    <li key={h.symbol}>
                      <div className="flex items-baseline justify-between text-[14px]">
                        <span className="font-mono font-semibold">{h.symbol}</span>
                        <span className="text-dim">{h.units.toLocaleString('en-US', { maximumFractionDigits: 4 })} · <span className="font-mono text-ink">{usd(h.usd)}</span></span>
                      </div>
                      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-raised"><div className={`h-full rounded-full ${h.stable ? 'bg-ink/45' : 'bg-ink'}`} style={{ width: `${Math.max(2, pct)}%` }} /></div>
                    </li>
                  )
                })}
              </ul>
            </Card>

            <Card title="Actions to take" note={`rules read from ${TREASURY}`}>
              <ul className="space-y-2">
                {actions.map((a, i) => (
                  <li key={i} className="flex gap-3 rounded-xl border border-line p-3">
                    <span className={`h-fit shrink-0 rounded-md px-2 py-0.5 text-[11.5px] font-medium ${a.level === 'act' ? 'bg-ink text-bg' : a.level === 'watch' ? 'bg-raised text-ink' : 'border border-line text-dim'}`}>{a.level === 'act' ? 'Act' : a.level === 'watch' ? 'Watch' : 'OK'}</span>
                    <div className="min-w-0">
                      <p className="text-[14.5px] font-medium">{a.title}</p>
                      <p className="text-[13px] text-dim">{a.detail}</p>
                      <p className="mt-0.5 text-[11.5px] uppercase tracking-wide text-dim">{a.source}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </>
      )}

      <Card title="Watched treasuries" note="Agent A · read through MultiBaas" className="mt-4">
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead><tr className="text-left text-[12px] uppercase tracking-wide text-dim"><th className="py-2 font-normal">Wallet</th><th className="font-normal">Value</th><th className="font-normal">Stablecoins</th><th className="font-normal">Largest</th></tr></thead>
            <tbody className="divide-y divide-line">
              {watched.map((w) => (
                <tr key={w.address}>
                  <td className="py-2.5"><span className="font-medium">{w.label}</span> <span className="font-mono text-[12px] text-dim">{short(w.address)}</span></td>
                  <td className="font-mono">{usd(w.totalUsd)}</td>
                  <td>{stablePct(w).toFixed(0)}%</td>
                  <td className="font-mono">{largest(w) ? `${largest(w)!.symbol} ${largest(w)!.pct.toFixed(0)}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <section className="mt-10">
        <h2 className="mb-3 text-[18px] font-semibold tracking-[-0.02em]">How it works</h2>
        <FlowGraph nodes={NODES(treasury?.version, treasury?.claims.length)} edges={EDGES} label="MultiBaas reads Base mainnet for Agent A, which writes to treasury.eth; Agent B reads it with your wallet and answers." />
      </section>
    </>
  )
}

const NODES = (version?: number, claims?: number): GraphNode[] => [
  { id: 'base', n: 1, title: 'Base mainnet', sub: 'wallets · DAOs · vesting', x: 215, y: 190, icon: 'eye' },
  { id: 'mb', n: 2, title: 'MultiBaas', sub: 'calls · events · queries', x: 215, y: 570, icon: 'calc' },
  { id: 'a', n: 3, title: 'Agent A · watcher', sub: 'writes sourced claims', x: 650, y: 380, icon: 'agent' },
  { id: 't', n: 4, title: TREASURY, sub: version ? `v${version} · ${claims} claims · ENS` : 'ENS → IPFS', x: 1090, y: 190, icon: 'flag' },
  { id: 'you', n: 5, title: 'Your wallet', sub: 'read through MultiBaas', x: 1090, y: 570, icon: 'key' },
  { id: 'b', n: 6, title: 'Agent B · treasury', sub: 'dashboard + answers', x: 1540, y: 380, icon: 'agent', final: true },
]
const EDGES: GraphEdge[] = [
  { from: 'base', to: 'mb', at: 10 },
  { from: 'mb', to: 'a', at: 30 },
  { from: 'a', to: 't', at: 72 },
  { from: 't', to: 'b', solid: true, at: 130 },
  { from: 'you', to: 'b', solid: true, at: 146 },
]

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <p className="text-[12.5px] text-dim">{label}</p>
      <p className="mt-1 font-mono text-[24px] font-semibold tabular-nums">{value}</p>
      <p className="truncate text-[12.5px] text-dim">{hint}</p>
    </div>
  )
}

function Card({ title, note, children, className = '' }: { title: string; note: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-line bg-surface p-5 ${className}`}>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <span className="text-[12px] text-dim">{note}</span>
      </div>
      {children}
    </section>
  )
}
