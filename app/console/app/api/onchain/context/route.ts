/**
 * What the treasury agent would read for this name: treasury.eth, the person's
 * own memory, and their wallets. Shown before the first question, so nothing
 * the agent relies on is hidden.
 */
import { NextResponse } from 'next/server'
import { loadContext } from '@/lib/treasuryAgent'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { name?: unknown; wallets?: unknown }
  const wallets = Array.isArray(body.wallets) ? body.wallets.filter((x): x is string => typeof x === 'string') : []
  try {
    const ctx = await loadContext(typeof body.name === 'string' ? body.name : '', wallets)
    return NextResponse.json({
      treasury: ctx.treasury && { namespace: ctx.treasury.namespace, version: ctx.treasury.version, claims: ctx.treasury.claims },
      user: ctx.user,
      wallets: ctx.wallets.map((w) => ({ address: w.address, ens: w.ens, totalUsd: w.totalUsd, holdings: w.holdings.slice(0, 8), movements: w.movements.length })),
      walletErrors: ctx.walletErrors,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'could not load' }, { status: 400 })
  }
}
