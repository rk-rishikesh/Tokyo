/**
 * Publishing what the connectors wrote (opt-in).
 *
 * The service holds no key unless you give it one. With `CONNECT_PRIVATE_KEY`
 * set it can publish on the namespace's own publish policy — batched, so a
 * chatty Slack channel does not become a transaction per message.
 *
 * Two safety rails, because this is the one place the service can spend money:
 *   - it publishes only namespaces whose owner the key actually controls, and
 *     says so when it does not;
 *   - it honours `publishDue()`, so the cadence is the namespace's setting, not
 *     the connector's whim. `force` is for a demo, where waiting ten minutes on
 *     stage is not an option.
 */
import { createPublicClient, createWalletClient, http, type Hex, type PublicClient, type WalletClient } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import { findOwner, normalisePrivateKey } from '@knowledge01/core'
import { EnsPointer, Remote, Repository } from '@knowledge01/repo'
import { createStorage } from '@knowledge01/storage'

export type PublishResult =
  | { status: 'published'; namespace: string; version: number; contenthash: string; tx: string | null; commits: number }
  | { status: 'not-due'; namespace: string; reason: string; pending: number }
  | { status: 'no-key'; namespace: string }
  | { status: 'not-owner'; namespace: string; owner: string; wallet: string }
  | { status: 'unregistered'; namespace: string; hint: string }
  | { status: 'error'; namespace: string; reason: string }

const RPC = () => process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'

/** The key the service publishes with, if it was given one. */
export const publishKey = (): Hex | null => normalisePrivateKey(process.env.CONNECT_PRIVATE_KEY ?? process.env.PRIVATE_KEY)

/**
 * Publish one namespace if its policy says a publish is due.
 *
 * Returns a status rather than throwing: a connector writing a claim must never
 * fail because the chain is slow, the key is missing, or the name is not ours.
 */
export async function publishIfDue(namespace: string, opts: { force?: boolean } = {}): Promise<PublishResult> {
  const key = publishKey()
  if (!key) return { status: 'no-key', namespace }
  try {
    const repo = Repository.open(namespace)
    const due = repo.publishDue()
    if (!due.due && !opts.force) return { status: 'not-due', namespace, reason: due.reason, pending: due.pending }
    if (!due.pending) return { status: 'not-due', namespace, reason: 'nothing to publish', pending: 0 }

    const account = privateKeyToAccount(key)
    const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC()) }) as PublicClient
    // Refuse early rather than sending a transaction that reverts.
    const owner = await findOwner(publicClient, namespace).catch(() => null)
    // Never registered: the claims are safe locally, there is simply no pointer to move.
    if (!owner || BigInt(owner) === 0n) return { status: 'unregistered', namespace, hint: `knowledge init ${namespace} --register` }
    if (owner.toLowerCase() !== account.address.toLowerCase()) {
      return { status: 'not-owner', namespace, owner, wallet: account.address }
    }
    const wallet = createWalletClient({ account, chain: sepolia, transport: http(RPC()) }) as WalletClient
    const remote = new Remote(repo, createStorage(), new EnsPointer(namespace, publicClient, wallet))
    const res = await remote.push()
    if (res.noop) return { status: 'not-due', namespace, reason: 'already up to date on chain', pending: 0 }
    return { status: 'published', namespace, version: repo.version(repo.refs.head), contenthash: res.contenthash, tx: res.receipt, commits: res.pushed.length }
  } catch (e) {
    return { status: 'error', namespace, reason: e instanceof Error ? e.message : String(e) }
  }
}
