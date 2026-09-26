/**
 * Whether Agent B should pay for a question.
 *
 * It used to buy whenever the question matched a list of words — "flow",
 * "whale", "this week" — which both overpaid ("what's a whale?") and missed
 * ("who's been loading up on AERO?"). The model decides now, knowing exactly
 * what it already has for free and what the paid tier adds; the word list is
 * kept only as a fallback when the model cannot be reached.
 */
import { complete, type LlmConfig } from '@knowledge01/connect'
import { SIGNALS } from './treasuryAgent'

export type Decision = { buy: boolean; reason: string; by: 'model' | 'keywords' }

/** What the paid tier holds, and what Agent B already has for free — the terms of the decision. */
const DECIDE = `You are Agent B, deciding whether to buy data before answering. You already have, free: live prices and 24h moves, yields on Base, what large Base wallets hold right now, the playbook, the user's own memory, and the user's wallets (balances and latest transfers). You can buy ${SIGNALS}: every watched whale wallet's transfers over the last 7 days and the net whale flow — nothing else. Buy only if the question cannot be answered well without those 7-day whale flows. Reply with BUY or SKIP, a colon, and a reason of at most 12 words.`

/**
 * Should Agent B pay for this question? The model decides, from the question
 * and the conversation; a keyword match is only the fallback when it cannot.
 */
export async function decideToBuy(cfg: LlmConfig, question: string, history: { role: 'user' | 'assistant'; content: string }[], price: string): Promise<Decision> {
  try {
    const { content } = await complete(cfg, [
      { role: 'system', content: `${DECIDE} The price is ${price} for a week of access.` },
      ...history.slice(-4).map((t) => ({ role: t.role, content: t.content.slice(0, 600) })),
      { role: 'user', content: `Question: ${question}` },
    ], { timeoutMs: 15_000 })
    const m = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim().match(/\b(BUY|SKIP)\b\s*:?\s*(.*)/i)
    if (m) return { buy: m[1]!.toUpperCase() === 'BUY', reason: m[2]!.split('\n')[0]!.trim().slice(0, 120) || (m[1]!.toUpperCase() === 'BUY' ? 'needs 7-day whale flows' : 'free data is enough'), by: 'model' }
  } catch { /* fall through to keywords */ }
  const buy = /\b(flow|flows|moved?|moving|whales?|transfers?|inflows?|outflows?|bought|sold|selling|buying|accumulat\w*|dump\w*|signals?|this week|activity)\b/i.test(question)
  return { buy, reason: buy ? 'the question mentions whale activity' : 'nothing in the question needs 7-day flows', by: 'keywords' }
}

