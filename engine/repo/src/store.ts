/**
 * The on-disk repository — the `.git` directory for a knowledge namespace.
 *
 *   <root>/
 *     config.json      namespace, identity, default branch, remote key
 *     HEAD             current branch name
 *     refs.json        branch → commit id; commit id → storage ref once pushed
 *     objects/<id>.json one commit per file, plaintext (encryption is a push concern)
 *     index.json       the working snapshot: what the next commit will contain
 *
 * Plaintext locally on purpose: this is the developer's own machine, and a
 * readable object store is what makes `log`, `diff` and recovery boring.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Commit, NamespaceKind, Refs, Snapshot } from '@recall/core'
import { emptyRefs, normalisePolicy, validateCommit } from '@recall/core'

export type RepoConfig = {
  namespace: string
  /** Who commits by default — an ENS name or address. */
  identity: string
  defaultBranch: string
  /** Hex content key used to encrypt on push. Never leaves this file. Absent for public namespaces. */
  contentKey?: string
  createdAt: string
  publish?: PublishState
}

export type InitOptions = {
  readers?: 'public' | 'key'
  kind?: NamespaceKind
  title?: string
  description?: string
  parent?: string
}

/** Where the local repository stands relative to the published namespace (PRD W4). */
export type PublishState = {
  /** Last successful push. */
  lastPublish?: { at: string; version: number; contenthash: string; commit?: string }
  /** Last pull that saw a remote. */
  lastPull?: { at: string; remoteUpdatedAt: string; version: number }
}

export function reposDir(): string {
  const base = process.env.RECALL_CACHE_DIR ?? '~/.recall'
  const root = base.startsWith('~') ? join(homedir(), base.slice(1)) : resolve(base)
  return join(root, 'repos')
}

export const repoPath = (namespace: string): string => join(reposDir(), namespace)

function writeAtomic(path: string, data: string): void {
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, data, { mode: 0o600 })
  renameSync(tmp, path)
}

export class RepoStore {
  private objects = new Map<string, Commit>()

  constructor(readonly root: string) {}

  static exists(root: string): boolean {
    return existsSync(join(root, 'config.json'))
  }

  static init(root: string, config: Omit<RepoConfig, 'createdAt'>, opts: InitOptions = {}): RepoStore {
    if (RepoStore.exists(root)) throw new Error(`repository already exists at ${root}`)
    mkdirSync(join(root, 'objects'), { recursive: true })
    const store = new RepoStore(root)
    store.writeConfig({ ...config, createdAt: new Date().toISOString() })
    // A key implies a private namespace unless the caller says otherwise.
    store.writeRefs(emptyRefs(config.namespace, config.identity, { head: config.defaultBranch, readers: config.contentKey ? 'key' : 'public', ...opts }))
    store.writeHead(config.defaultBranch)
    store.writeIndex({})
    return store
  }

  static open(root: string): RepoStore {
    if (!RepoStore.exists(root)) throw new Error(`no repository at ${root} — run \`memory init\` first`)
    const store = new RepoStore(root)
    store.loadObjects()
    return store
  }

  // ---- config / HEAD / refs / index ----

  readConfig(): RepoConfig { return JSON.parse(readFileSync(join(this.root, 'config.json'), 'utf8')) }
  writeConfig(c: RepoConfig): void { writeAtomic(join(this.root, 'config.json'), JSON.stringify(c, null, 2)) }

  readHead(): string { return readFileSync(join(this.root, 'HEAD'), 'utf8').trim() }
  writeHead(branch: string): void { writeAtomic(join(this.root, 'HEAD'), branch + '\n') }

  /** Refs, with fields older repositories lack filled in so every caller sees one shape. */
  readRefs(): Refs {
    const r = JSON.parse(readFileSync(join(this.root, 'refs.json'), 'utf8')) as Refs
    r.policy = normalisePolicy(r.policy)
    r.proposals ??= {}; r.sources ??= {}; r.findings ??= {}; r.outbox ??= {}; r.children ??= []
    return r
  }
  writeRefs(r: Refs): void { writeAtomic(join(this.root, 'refs.json'), JSON.stringify(r, null, 2)) }

  readIndex(): Snapshot { return JSON.parse(readFileSync(join(this.root, 'index.json'), 'utf8')) }
  writeIndex(s: Snapshot): void { writeAtomic(join(this.root, 'index.json'), JSON.stringify(s, null, 2)) }

  // ---- objects ----

  private loadObjects(): void {
    const dir = join(this.root, 'objects')
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue
      const c = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Commit
      this.objects.set(c.id, c)
    }
  }

  getCommit = (id: string): Commit | undefined => this.objects.get(id)

  hasCommit(id: string): boolean { return this.objects.has(id) }

  /** Store a commit. Validated first, so a bad object never lands on disk. */
  putCommit(c: Commit): void {
    validateCommit(c)
    if (this.objects.has(c.id)) return
    writeAtomic(join(this.root, 'objects', `${c.id}.json`), JSON.stringify(c, null, 2))
    this.objects.set(c.id, c)
  }

  allCommitIds(): string[] { return [...this.objects.keys()] }
}
