/**
 * Everything a command needs: the repository, and (lazily) the remote.
 *
 * The remote is only built for push/pull and init --register, so every other
 * command works with no RPC, no key and no network — like git works offline.
 */
import { config as loadEnv } from 'dotenv'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createPublicClient, createWalletClient, http, type PublicClient, type WalletClient } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import { normalisePrivateKey } from '@recall/core'
import { EnsPointer, Remote, Repository, RepoStore, repoPath, reposDir } from '@recall/repo'
import { createStorage } from '@recall/storage'

for (const p of ['.env', '../.env', '../../.env']) if (existsSync(p)) loadEnv({ path: p })

export const RPC = process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'

export function localNamespaces(): string[] {
  const dir = reposDir()
  return existsSync(dir) ? readdirSync(dir).filter((d) => RepoStore.exists(join(dir, d))) : []
}

/** Which namespace a command targets: positional/flag, env, or the only repo on disk. */
export function resolveNamespace(flag?: string): string {
  if (flag) return flag
  if (process.env.KNOWLEDGE_NAMESPACE) return process.env.KNOWLEDGE_NAMESPACE
  const repos = localNamespaces()
  if (repos.length === 1) return repos[0]!
  if (repos.length === 0) throw new Error('no knowledge namespace found — run `knowledge init <name.eth>`')
  throw new Error(`several namespaces exist (${repos.join(', ')}); pass --namespace or set KNOWLEDGE_NAMESPACE`)
}

export function openRepo(flag?: string): Repository {
  const ns = resolveNamespace(flag)
  if (!RepoStore.exists(repoPath(ns))) throw new Error(`no repository for ${ns} — run \`knowledge init ${ns}\``)
  const repo = Repository.open(ns)
  // `--as` lets one machine act as different roles — useful for demos and tests, and honest:
  // roles are protocol-level; only the pointer is enforced on chain.
  return repo
}

export function actAs(repo: Repository, identity?: string): Repository {
  if (identity) repo.actingAs = identity
  return repo
}

export function publicClient(): PublicClient {
  return createPublicClient({ chain: sepolia, transport: http(RPC) }) as PublicClient
}

export function walletClient(): WalletClient | undefined {
  const pk = normalisePrivateKey(process.env.PRIVATE_KEY)
  if (!pk) return undefined
  return createWalletClient({ account: privateKeyToAccount(pk), chain: sepolia, transport: http(RPC) }) as WalletClient
}

export function remoteFor(repo: Repository): Remote {
  return new Remote(repo, createStorage(), new EnsPointer(repo.namespace, publicClient(), walletClient()))
}
