/**
 * Agent B, the treasury agent: one question, answered from what it read.
 *
 * The context is rebuilt on the server from ENS, IPFS and the chain — never
 * taken from the browser — so an answer is grounded in the network, not in
 * whatever a page sent.
 */
import { NextResponse } from 'next/server'
import { complete, llmConfig, type ChatMessage } from '@knowledge01/connect'
import { loadContext, promptData, TREASURY } from '@/lib/treasuryAgent'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SYSTEM = `You are the treasury agent (Agent B). You answer using ONLY the JSON below, which has three parts:
- treasury_memory: ${TREASURY}, written by a separate watcher agent (Agent A). It holds the treasury playbook (topic "policy"), current prices, what well-known treasuries hold and moved, and benchmarks.
- user_memory: the user's own namespaces under their ENS name — their preferences and history, if any.
- user_wallets: the user's wallets, read live from Ethereum mainnet.

How to answer:
- Recommend actions by applying the playbook's policies to the user's balances and liquidity needs, and compare with the watched treasuries where that helps. Give amounts.
- Answer questions about holdings, transactions, yield or history from user_wallets. You only see the latest movements, not full history; say so when that matters. For yield-bearing tokens (stETH, wstETH, aUSDC, sDAI, rETH…), say they earn yield but the rate is not in the data.
- Cite where each point came from in brackets: [treasury.eth: <subject>], [<namespace>: <subject>], or [wallet 0x12…34].
- If the data cannot answer, say what is missing. Never invent balances, prices, transactions or policies. If the user's monthly spend or needs are not in their memory, ask for them instead of assuming.
- Be brief and direct. Plain text; short lines; no tables. Recommendations only — you never sign or send anything.`

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { question?: unknown; name?: unknown; wallets?: unknown; history?: unknown }
  const question = typeof body.question === 'string' ? body.question.trim().slice(0, 600) : ''
  if (!question) return NextResponse.json({ error: 'ask a question' }, { status: 400 })
  const cfg = llmConfig()
  if (!cfg) return NextResponse.json({ error: 'No model is configured on this deployment (set OPENROUTER_API_KEY).' }, { status: 503 })

  let data: string
  try {
    const wallets = Array.isArray(body.wallets) ? body.wallets.filter((x): x is string => typeof x === 'string') : []
    data = promptData(await loadContext(typeof body.name === 'string' ? body.name : '', wallets))
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'could not load memory' }, { status: 400 })
  }

  const history = Array.isArray(body.history)
    ? body.history.filter((t): t is { role: 'user' | 'assistant'; content: string } => !!t && typeof t === 'object' && ['user', 'assistant'].includes((t as { role?: string }).role ?? '') && typeof (t as { content?: unknown }).content === 'string').slice(-6)
    : []
  const messages: ChatMessage[] = [
    { role: 'system', content: `${SYSTEM}\n\nToday is ${new Date().toISOString().slice(0, 10)}.\n\nDATA:\n${data}` },
    ...history.map((t) => ({ role: t.role, content: t.content.slice(0, 2000) })),
    { role: 'user', content: question },
  ]
  try {
    const { content, model } = await complete(cfg, messages)
    // The chat renders plain text; free models reach for markdown regardless.
    const answer = content.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/^\s*[*-]\s+/gm, '• ').replace(/^#+\s*/gm, '').trim()
    return NextResponse.json({ answer, model })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'the model did not answer' }, { status: 502 })
  }
}
