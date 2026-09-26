/**
 * What Agent B would read: treasury.eth, the person's own memory if they
 * brought it, and the wallets on Base it follows. Shown before the first
 * question, so nothing the agent relies on is hidden.
 */
import { NextResponse } from 'next/server'
import { loadContext, SIGNALS } from '@/lib/treasuryAgent'
import { standing } from '@/lib/x402Buyer'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { name?: unknown; wallets?: unknown }
  const wallets = Array.isArray(body.wallets) ? body.wallets.filter((x): x is string => typeof x === 'string') : []
  try {
    const [ctx, paid] = await Promise.all([
      loadContext(typeof body.name === 'string' ? body.name : null, wallets),
      standing(SIGNALS).catch(() => null),
    ])
    return NextResponse.json({
      treasury: ctx.treasury && { namespace: ctx.treasury.namespace, version: ctx.treasury.version, claims: ctx.treasury.claims },
      user: ctx.user,
      wallets: ctx.wallets.map((w) => ({ role: w.role, label: w.label, address: w.address, via: w.via, totalUsd: w.totalUsd, holdings: w.holdings.slice(0, 6), movements: w.movements.length })),
      walletErrors: ctx.walletErrors,
      paid: paid && { namespace: SIGNALS, ...paid },
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'could not load' }, { status: 400 })
  }
}
