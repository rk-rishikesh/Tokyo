'use server'

/**
 * The buttons on the app. Each one is a real write: granting access stores a
 * grant, and letting the agent observe produces real commits in namespaces the
 * person owns.
 *
 * Every action resolves the viewer first. On a hosted deployment that is the
 * signed-in user, and a caller who is not signed in gets nothing — the agent
 * must never read a source or write a claim on behalf of someone who has not
 * asked it to.
 */
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { agentsOf, answerDecision, grant, namespacesOf, type Answer, publishShared, revoke, shareNamespace, tick, tickUser, accessToken, unshareNamespace } from '@knowledge01/connect'
import { Repository } from '@knowledge01/repo'
import { ownerOf, viewer } from '@/lib/session'

export async function connectWorkspace(workspaceId: string): Promise<void> {
  const v = await viewer()
  if (v.mode === 'hosted' && !v.user) throw new Error('sign in first')
  grant(workspaceId, v.mode === 'hosted' ? v.user!.id : undefined)
  revalidatePath('/app')
}

export async function disconnectWorkspace(workspaceId: string): Promise<void> {
  const v = await viewer()
  if (v.mode === 'hosted' && !v.user) throw new Error('sign in first')
  revoke(workspaceId, v.mode === 'hosted' ? v.user!.id : undefined)
  revalidatePath('/app')
}

export type AgentRun = { checked: number; written: number; byModel: number; model: string | null }

/**
 * One pass of the watcher: read every granted source, write what is new.
 * Called on a timer by the client, so nobody has to press anything.
 */
export async function runAgent(): Promise<AgentRun> {
  const v = await viewer()
  const owner = ownerOf(v)
  if (!owner) return { checked: 0, written: 0, byModel: 0, model: null }

  const r = v.mode === 'hosted'
    ? await tickUser(v.user!)
    // Only on someone's own machine may the agent fall back to credentials that
    // are already there (the `gh` CLI's token). A hosted visitor gets their own
    // account or nothing.
    : await tick({ owner, allowLocalCredentials: true })

  if (r.written.length) revalidatePath('/app')
  return { checked: r.checked, written: r.written.length, byModel: r.written.filter((w) => w.by === 'model').length, model: r.model }
}

/** Whether a provider is connected, for the source list. */
export async function providerConnected(provider: 'github' | 'google'): Promise<boolean> {
  const v = await viewer()
  if (v.mode !== 'hosted' || !v.user) return false
  return !!accessToken(v.user.id, provider)
}

// ---------------------------------------------------------------------------
// Access — sealing a namespace's key to an agent that is not this app
// ---------------------------------------------------------------------------

async function ownerOrThrow(): Promise<string> {
  const v = await viewer()
  const owner = ownerOf(v)
  if (!owner) throw new Error('sign in first')
  return owner
}

export async function grantToAgent(namespace: string, agent: string, pubkey: string, role: 'read' | 'propose' = 'read'): Promise<void> {
  const owner = await ownerOrThrow()
  await shareNamespace(owner, namespace, { agent, pubkey: pubkey as `0x${string}`, role })
  revalidatePath('/app/access')
}

export async function revokeFromAgent(namespace: string, grantId: string): Promise<void> {
  const owner = await ownerOrThrow()
  await unshareNamespace(owner, namespace, grantId)
  revalidatePath('/app/access')
}

/** Revoke one agent from everything, re-keying each namespace it could read. */
export async function revokeAgentEverywhere(grantId: string): Promise<void> {
  const owner = await ownerOrThrow()
  for (const a of await agentsOf(owner)) {
    if (a.id !== grantId) continue
    for (const n of a.namespaces) await unshareNamespace(owner, n.namespace, grantId)
  }
  revalidatePath('/app/access')
}

/**
 * The answer to an access request: grant what was ticked, and send the agent
 * back to where it asked to be sent, with the list. The list is a hint; what
 * the agent can actually read is decided by the sealed keys on the network.
 */
export async function answerAccessRequest(form: FormData): Promise<void> {
  const owner = await ownerOrThrow()
  const agent = String(form.get('agent') ?? 'An agent')
  const pubkey = String(form.get('pubkey') ?? '')
  const role = form.get('role') === 'propose' ? 'propose' : 'read'
  const redirectUri = String(form.get('redirect_uri') ?? '')
  const state = String(form.get('state') ?? '')
  const decision = String(form.get('decision') ?? 'deny')
  const offered = form.getAll('offered').map(String)
  const chosen = decision === 'allow' ? form.getAll('ns').map(String).filter((n) => offered.includes(n)) : []

  for (const ns of chosen) await shareNamespace(owner, ns, { agent, pubkey: pubkey as `0x${string}`, role })

  const back = safeRedirect(redirectUri)
  if (!back) redirect('/app/access')
  back.searchParams.set('state', state)
  if (!chosen.length) back.searchParams.set('error', 'access_denied')
  else {
    back.searchParams.set('granted', chosen.join(','))
    const denied = offered.filter((n) => !chosen.includes(n))
    if (denied.length) back.searchParams.set('denied', denied.join(','))
  }
  redirect(back.toString())
}

/** Only http(s), and only somewhere the page showed the person first. */
function safeRedirect(uri: string): URL | null {
  try {
    const u = new URL(uri)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null
  } catch { return null }
}

/**
 * Approve or reject a proposal on one of the owner's own namespaces.
 *
 * The owner is the reviewer here, so the app records the verdict as the
 * namespace's identity. Public namespaces with other reviewers still go through
 * the signed CLI path, because there the reviewer is not the person clicking.
 */
export async function decideProposal(namespace: string, number: number, verdict: 'approve' | 'reject'): Promise<void> {
  const owner = await ownerOrThrow()
  if (!namespacesOf(owner).includes(namespace)) throw new Error(`${namespace} is not yours to review`)
  const repo = Repository.open(namespace)
  const p = repo.review(number, verdict)
  if (p.status === 'approved') repo.land(number)
  await publishShared([namespace]).catch(() => [])
  revalidatePath('/app/publish')
  revalidatePath('/app/memory')
}

/** Answer one of the owner's open questions (a conflict, a duplicate, a claim with no source). */
export async function answerFinding(namespace: string, commit: string, index: number, answer: Answer): Promise<void> {
  const owner = await ownerOrThrow()
  answerDecision(owner, namespace, commit, index, answer)
  revalidatePath('/app/publish')
  revalidatePath('/app/memory')
}
