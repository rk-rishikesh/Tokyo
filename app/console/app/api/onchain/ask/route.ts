/**
 * Agent B, Portfolio Intelligence: one question, answered as a short report
 * from what it read.
 *
 * The context is rebuilt on the server from ENS, IPFS, MultiBaas and the
 * explorer — never taken from the browser — so an answer is grounded in the
 * network, not in whatever a page sent.
 */
import { NextResponse } from 'next/server'
import { complete, llmConfig, type ChatMessage } from '@knowledge01/connect'
import { AccessDenied } from '@knowledge01/repo'
import { loadContext, promptData, SIGNALS, TREASURY } from '@/lib/treasuryAgent'
import { readPaid, standing, type PaidRead } from '@/lib/x402Buyer'
import { decideToBuy, type Decision } from '@/lib/buyDecision'
import { NETWORK_NAME } from '@/lib/x402'
import { namespaceRead, paidRead } from '@/lib/trace'
import type { TraceCall } from '@/components/chat/AgentTrace'
import type { Context } from '@/lib/treasuryAgent'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SYSTEM = `You are Agent B, Portfolio Intelligence. You answer natural-language questions about holdings, transactions, yield and historical activity on Base, using ONLY the JSON below:
- treasury_memory: ${TREASURY}, which you inherit. Written by Agent A (Market Scout): prices and 24h moves (topic "prices"), yields on Base (topic "yields"), what large Base wallets hold (topic "treasuries"), benchmarks, and the owner's playbook (topic "policy").
- user_memory: the user's own memory, if they brought it — which wallets are theirs, which they track, which coins they watch, their spend and risk preferences. Their preferences override the playbook where they differ.
- paid_memory: ${SIGNALS}, Agent A's paid tier — each watched wallet's transfers over the last 7 days and the net whale flow. You bought read access to it from Agent A over x402 (it was cheaper than watching every transfer yourself). Null when you have not bought it; then say so if the question needs 7-day whale flows.
- prices_now_usd: live prices.
- wallets: role "yours" or "tracked", read live on Base: holdings through MultiBaas, movements through Blockscout. flows_7d and flows_30d are totals of the movements seen.

Answer as a short report:
- Open with one line that answers the question, with the key number.
- Then 2–4 short sections, each a line starting "## " (e.g. "## Holdings", "## Activity", "## Yield", "## Watchlist"), each with 1–4 lines starting "• ". Only the sections the question needs.
- Give amounts in USD and units. Compare with tracked wallets or the benchmarks when it helps.
- Yield: for idle stablecoins or ETH, name the matching pools in treasury_memory (protocol, APY, TVL) and what the balance would earn per year; cbETH and wstETH already earn staking yield. Respect the user's risk preferences.
- History: you only see the latest movements (movements_seen, since oldest_movement_seen); say so when a question reaches further back.
- Cite sources inline in brackets: [${TREASURY}: <subject>], [${SIGNALS}: <subject>], [<namespace>: <subject>], [wallet <label>].
- Never invent balances, prices, transactions, yields or policies, and never guess why something moved. If the data cannot answer, say what is missing.
- End with "## Suggested moves" whenever the question touches the user's holdings, their watchlist, whale activity or yield: 1–4 lines, one per asset, each starting "• " and then exactly one of Hold, Buy, Add, Trim, Sell, Stake, Earn or Watch, then the asset and an amount in units and USD, then "—" and the reason.
- A suggested move must follow from the data, and say which: the playbook rules (topic "policy": concentration limit, gas reserve, runway, rebalancing pace, outflow alert), the user's own preferences in user_memory (which override the playbook), the yields in treasury_memory, and the 7-day whale flows in paid_memory. Cite each, e.g. [treasury.eth: Concentration limit].
- Keep moves inside the rules: never above the rebalancing pace in one step, never below the gas reserve or the runway, never riskier than the user's stated risk. Idle stablecoins or ETH with a matching pool → Earn or Stake, naming the pool, its APY and what the amount would earn a year. Nothing breached and nothing idle → Hold, and say so.
- Whale flows are a signal of attention, not a forecast: at most they justify Watch, or a smaller step. Never claim a price will rise or fall.
- After the moves, one line: "Suggestions from the data above, not financial advice. Agent B never signs or sends."
- Plain text apart from "## " and "• ". No tables, no bold. Recommendations only — you never sign or send anything.`

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { question?: unknown; name?: unknown; wallets?: unknown; history?: unknown }
  const question = typeof body.question === 'string' ? body.question.trim().slice(0, 600) : ''
  if (!question) return NextResponse.json({ error: 'ask a question' }, { status: 400 })
  const cfg = llmConfig()
  if (!cfg) return NextResponse.json({ error: 'No model is configured on this deployment (set OPENROUTER_API_KEY).' }, { status: 503 })

  const history = Array.isArray(body.history)
    ? body.history.filter((t): t is { role: 'user' | 'assistant'; content: string } => !!t && typeof t === 'object' && ['user', 'assistant'].includes((t as { role?: string }).role ?? '') && typeof (t as { content?: unknown }).content === 'string').slice(-6)
    : []

  // Whale flows are the paid tier. A live grant is simply read; without one,
  // Agent B decides whether this question is worth paying for — at most once
  // an epoch, since the grant it buys is then read for free.
  const held = await standing(SIGNALS).catch(() => null)
  const decision = held && !held.holds && held.price ? await decideToBuy(cfg, question, history, held.price) : null
  let paid: PaidRead | null = null
  let paidError: string | null = null
  try { paid = await readPaid(SIGNALS, { buy: !!decision?.buy }) } catch (e) { if (!(e instanceof AccessDenied)) paidError = e instanceof Error ? e.message : 'could not buy access' }

  let data: string
  let ctx: Context
  try {
    const wallets = Array.isArray(body.wallets) ? body.wallets.filter((x): x is string => typeof x === 'string') : []
    ctx = await loadContext(typeof body.name === 'string' ? body.name : null, wallets)
    data = promptData(ctx, paid)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'could not load memory' }, { status: 400 })
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: `${SYSTEM}\n\nToday is ${new Date().toISOString().slice(0, 10)}.\n\nLIMITS (computed from the playbook and the user's wallets — suggested moves must stay inside them):\n${limitsOf(ctx)}\n\nDATA:\n${data}` },
    ...history.map((t) => ({ role: t.role, content: t.content.slice(0, 2000) })),
    { role: 'user', content: question },
  ]
  try {
    const { content, model } = await complete(cfg, messages)
    // The chat renders plain text; free models reach for markdown regardless.
    const answer = content.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/^\s*[*-]\s+/gm, '• ').replace(/^#+\s*/gm, '## ').trim()
    return NextResponse.json({
      answer, model, trace: traceOf(ctx, paid, question, decision),
      versions: Object.fromEntries([...(ctx.treasury ? [[ctx.treasury.namespace, ctx.treasury.version]] : []), ...ctx.user.memories.map((m) => [m.namespace, m.version]), ...(paid ? [[paid.namespace, paid.version]] : [])]),
      paid: paid ? { namespace: paid.namespace, version: paid.version, validUntil: paid.validUntil, price: paid.price } : null,
      purchase: paid?.purchase ?? null,
      ...(decision ? { decision } : {}),
      ...(paidError ? { paidError } : {}),
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'the model did not answer' }, { status: 502 })
  }
}

/**
 * The playbook's limits as numbers, so a suggested move is checked arithmetic
 * rather than the model's: a free model will happily "move $14,000" of a
 * $17,000 wallet in one step, or stake the ETH that pays for gas.
 */
function limitsOf(ctx: Context): string {
  const mine = ctx.wallets.filter((w) => w.role === 'yours')
  const total = mine.reduce((n, w) => n + w.totalUsd, 0)
  if (!mine.length || !total) return '- none: no wallet of the user\'s was read, so suggest nothing that moves funds.'
  const ethUsd = ctx.prices.ETH ?? ctx.prices.WETH ?? 0
  const memory = ctx.user.memories[0]?.namespace
  return [
    `- total_usd: ${Math.round(total)} across ${mine.length} wallet(s) of the user's`,
    `- max_step_usd: ${Math.round(total * 0.1)} — the rebalancing pace (10% of holdings) caps any single move today; for a larger target, give only this first step and say the rest follows in later steps`,
    `- gas_reserve: 0.05 ETH per wallet${ethUsd ? ` (≈ $${(0.05 * ethUsd).toFixed(0)})` : ''} stays as native ETH — never stake, lend or sell it`,
    `- cite the user's preferences as [${memory ?? 'their memory'}: <subject>], never as "user_memory"`,
  ].join('\n')
}

/** The reads behind this answer, in the order Agent B made them. */
function traceOf(ctx: Context, paid: PaidRead | null, question: string, decision: Decision | null): TraceCall[] {
  const calls: TraceCall[] = []
  if (ctx.treasury) calls.push(namespaceRead({ namespace: ctx.treasury.namespace, version: ctx.treasury.version, claims: ctx.treasury.claims, question }))
  for (const m of ctx.user.memories) calls.push(namespaceRead({ namespace: m.namespace, version: m.version, claims: m.claims, question }))
  if (paid) {
    const claims = paid.claims.map((c) => ({ subject: c.subject, claim: c.claim, topic: c.topic, contributor: c.contributor, confidence: c.confidence, sources: c.sources.map((x) => x.title ?? x.type) }))
    calls.push(paid.purchase
      ? paidRead({ namespace: paid.namespace, version: paid.version, claims, question, price: paid.purchase.amount, network: NETWORK_NAME[paid.purchase.network] ?? paid.purchase.network, tx: paid.purchase.tx, validUntil: paid.validUntil, ...(decision?.buy ? { reason: decision.reason } : {}) })
      : namespaceRead({ namespace: paid.namespace, version: paid.version, claims, question, sealed: 'grant' }))
  }
  if (ctx.wallets.length) {
    const top = [...ctx.wallets].sort((a, b) => (a.role === 'yours' ? -1 : 1) - (b.role === 'yours' ? -1 : 1))[0]!
    const moves = ctx.wallets.reduce((n, w) => n + w.movements.length, 0)
    const usd = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n).toLocaleString('en-US')}`)
    calls.push({
      tool: 'multibaas_read',
      args: { chain: 'Base mainnet', wallets: ctx.wallets.length },
      steps: [
        { label: `ETH and token balances through MultiBaas, for ${ctx.wallets.map((w) => w.label).join(', ')}` },
        { label: 'Price every holding through DefiLlama' },
        { label: `Read ${moves} transfers from Base Blockscout` },
      ],
      retrieved: {
        source: 'Base mainnet · live', count: ctx.wallets.length, unit: ctx.wallets.length === 1 ? 'wallet' : 'wallets',
        top: `${top.label} holds ${usd(top.totalUsd)}${top.holdings.length ? `, most in ${top.holdings[0]!.symbol}` : ''}`,
        chips: [top.role, ...top.holdings.slice(0, 3).map((h) => `${h.symbol} ${usd(h.usd)}`), `${top.movements.length} transfers`],
      },
    })
  }
  return calls
}
