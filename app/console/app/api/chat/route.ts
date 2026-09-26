/**
 * Chat, and the approval of anything it wants to change.
 *
 * Both paths resolve the viewer first. A write is only ever executed through
 * `approve`, and only for the person whose session asked for it.
 */
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { approve, ask, readUser, SESSION_COOKIE, verifySession, type ChatAnswer, type ChatTurn, type PendingAction } from '@knowledge01/connect'
import { defaultBranch, loadRepo, versionOf } from '@/lib/repoview'
import { namespaceRead } from '@/lib/trace'
import type { TraceCall } from '@/components/chat/AgentTrace'

export async function POST(req: Request) {
  const jar = await cookies()
  const id = verifySession(jar.get(SESSION_COOKIE)?.value)
  const user = id ? readUser(id) : null
  if (!user) return NextResponse.json({ error: 'sign in first' }, { status: 401 })

  const body = (await req.json()) as { message?: string; history?: ChatTurn[]; approve?: PendingAction }

  if (body.approve) {
    const out = await approve(user, body.approve)
    return NextResponse.json(out)
  }
  if (!body.message?.trim()) return NextResponse.json({ error: 'say something' }, { status: 400 })

  try {
    const answer = await ask(user, body.history ?? [], body.message)
    const { trace, versions } = await traceOf(answer, body.message)
    return NextResponse.json({ ...answer, trace, versions })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'chat failed' }, { status: 500 })
  }
}

/**
 * What the answer drew on, as the chat shows it: a read of each of the
 * person's namespaces, then each tool it called in a connected app.
 */
async function traceOf(a: ChatAnswer, question: string): Promise<{ trace: TraceCall[]; versions: Record<string, number> }> {
  const byNs = new Map<string, ChatAnswer['used']>()
  for (const u of a.used) byNs.set(u.namespace, [...(byNs.get(u.namespace) ?? []), u])
  const versions: Record<string, number> = {}
  const trace: TraceCall[] = []
  for (const [namespace, claims] of byNs) {
    const v = await loadRepo(namespace).catch(() => null)
    const version = v ? versionOf(v, defaultBranch(v)) : 0
    if (version) versions[namespace] = version
    trace.push(namespaceRead({
      namespace, version, question, sealed: v?.refs.policy.readers === 'key' ? 'key' : false,
      claims: claims.map((c) => ({ subject: null, topic: null, claim: c.claim, sources: c.sources })),
    }))
  }
  for (const c of a.called) {
    const args = Object.fromEntries(Object.entries(c.args ?? {}).slice(0, 3).map(([k, v]) => [k, typeof v === 'number' ? v : String(typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 60)]))
    trace.push({
      tool: c.tool, args,
      steps: [{ label: `Call ${c.server ?? 'the app'} over MCP` }, c.ok ? { label: 'Read the result as data, not instructions' } : { label: `Failed: ${c.error ?? 'no result'}`, ok: false }],
      ...(c.ok && c.preview ? { retrieved: { source: c.server ?? c.tool, count: 1, unit: 'result', top: c.preview.length > 180 ? `${c.preview.slice(0, 180)}…` : c.preview } } : {}),
    })
  }
  return { trace, versions }
}
