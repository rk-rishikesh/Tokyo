/**
 * `knowledge roles`: the policy's owner, reviewers and contributors, as ENS sees them.
 *
 * The policy says who reviews and who may propose; ENS decides who can write.
 * These keep them the same: a reviewer is granted ROLE_SET_CONTENTHASH on the
 * namespace's name, so what they land they can also publish; a named
 * contributor is granted ROLE_SET_DATA on their own proposal key, so they can
 * point the owner at a proposal. Dropping someone from the policy revokes it.
 */
import { onchainRoles, planRoles, policyMembers, roleChangeCall, type OnchainRole } from '@knowledge01/core'
import type { Repository } from '@knowledge01/repo'
import { publicClient, walletClient } from './context.js'
import { fmt } from './format.js'

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const contributorsOf = (c: 'anyone' | string[]) => (Array.isArray(c) ? c : [])

function can(r: OnchainRole): string {
  if (r.canGrant) return fmt.ok('publishes · can grant')
  if (r.canPublish) return fmt.ok('publishes')
  if (r.role === 'contributor') return r.canPropose ? fmt.ok('can propose on ENS') : fmt.warn('cannot propose on ENS')
  return fmt.warn('cannot publish')
}

export async function showRoles(repo: Repository, out: (s: string) => void, json?: (o: unknown) => void): Promise<OnchainRole[]> {
  const { resolver, roles } = await onchainRoles(publicClient(), repo.namespace, policyMembers(repo.policy))
  if (json) { json({ namespace: repo.namespace, resolver, roles }); return roles }
  if (!resolver) { out(fmt.dim(`${repo.namespace} is not registered on chain — roles are enforced locally until it is`)); return roles }
  out(`${fmt.bold(repo.namespace)}  ${fmt.dim(`resolver ${resolver}`)}`)
  for (const r of roles) out(`  ${r.role.padEnd(12)}${r.name.padEnd(28)}${r.account ? fmt.dim(short(r.account)) : fmt.warn('no owner on ENS')}  ${can(r)}`)
  if (repo.policy.contributors === 'anyone') out(fmt.dim('  contributors: anyone — proposals arrive as bundles (propose --export), not through ENS'))
  const behind = roles.filter((r) => r.account && ((r.role === 'reviewer' && !r.canPublish) || (r.role === 'contributor' && !r.canPropose)))
  if (behind.length) out(fmt.dim(`  ${behind.length} member(s) not yet granted on ENS — knowledge roles --sync, with the owner's PRIVATE_KEY`))
  return roles
}

/** Make ENS match the policy, including revoking from anyone in `previous` who has been dropped. */
export async function syncRoles(repo: Repository, previous: { reviewers: string[]; contributors: 'anyone' | string[] }, out: (s: string) => void): Promise<void> {
  const client = publicClient()
  const members = policyMembers(repo.policy, { reviewers: previous.reviewers, contributors: contributorsOf(previous.contributors) })
  const { resolver, roles } = await onchainRoles(client, repo.namespace, members)
  if (!resolver) { out(fmt.dim(`  ${repo.namespace} is not on chain yet — run knowledge roles --sync once it is registered`)); return }
  const { changes, unresolved } = planRoles(roles, { reviewers: repo.policy.reviewers, contributors: contributorsOf(repo.policy.contributors) })
  for (const n of unresolved) out(fmt.warn(`  ${n} has no owner on ENS — nothing to grant to`))
  if (!changes.length) { out(fmt.dim('  ENS already matches the policy')); return }
  const wallet = walletClient()
  if (!wallet?.account) { out(fmt.warn(`  ${changes.length} role change(s) pending on ENS — set the owner's PRIVATE_KEY and run knowledge roles --sync`)); return }
  for (const c of changes) {
    const hash = await wallet.sendTransaction({ account: wallet.account, chain: wallet.chain, to: resolver, data: roleChangeCall(repo.namespace, c) } as never)
    const receipt = await client.waitForTransactionReceipt({ hash })
    const what = c.kind === 'publish' ? 'publishing' : 'their proposal key'
    if (receipt.status !== 'success') throw new Error(`${c.grant ? 'granting' : 'revoking'} ${what} for ${c.name} reverted (${hash}) — is this wallet the namespace owner?`)
    out(`${fmt.ok('✓')} ${c.grant ? 'granted' : 'revoked'} ${what} ${c.grant ? 'to' : 'from'} ${c.name} (${short(c.account)}) · ${hash.slice(0, 10)}…`)
  }
}
