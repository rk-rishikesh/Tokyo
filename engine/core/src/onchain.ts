/**
 * Moving what is staged locally onto the owner's name — one transaction at a time,
 * each one the owner's.
 *
 * This never sends anything. It reads the chain, works out the single next
 * transaction that brings it closer to the staged state, simulates it as the
 * owner, and returns calldata for the owner's wallet to send. Call it again
 * after that transaction lands and it returns the one after, until nothing is
 * left. Working from chain state rather than from a script means a half-finished
 * setup resumes where it stopped, and a step that already happened is skipped.
 *
 * The shape it builds, for a root name `you.eth`:
 *
 *   you.eth           resolver R   subregistry S   (one-time: deploy R, deploy S, link both)
 *   food.you.eth      registered in S, resolver R  (one-time per namespace)
 *   projects.you.eth  registered in S, resolver R
 *
 * Every namespace shares R. Records are keyed by namehash, so one resolver can
 * hold many names — and that is what lets a publish of every namespace be a
 * single `multicall` rather than a transaction each.
 */
import {
  encodeFunctionData, getAddress, namehash, zeroAddress,
  type Address, type Hex, type PublicClient,
} from 'viem'
import { abis, addresses } from './contracts.js'
import { findOwner, findResolver, getEthRegistry, getSubregistry, keccakLabel, splitName } from './resolve.js'
import { RegistryRoles, RegistryRolesAdmin, ResolverRoles, ResolverRolesAdmin, combineRoles } from './roles.js'

export const ACCESS_TEXT_KEY = 'knowledge.access'

const OWNER_REGISTRY_ROLES = combineRoles(
  RegistryRoles.REGISTRAR, RegistryRolesAdmin.REGISTRAR,
  RegistryRoles.RENEW, RegistryRolesAdmin.RENEW,
  RegistryRoles.SET_SUBREGISTRY, RegistryRolesAdmin.SET_SUBREGISTRY,
  RegistryRoles.SET_RESOLVER, RegistryRolesAdmin.SET_RESOLVER,
  RegistryRoles.UNREGISTER, RegistryRolesAdmin.UNREGISTER,
  RegistryRoles.SET_PARENT, RegistryRolesAdmin.SET_PARENT,
)
const OWNER_RESOLVER_ROLES = combineRoles(
  ResolverRoles.SET_CONTENTHASH, ResolverRolesAdmin.SET_CONTENTHASH,
  ResolverRoles.SET_TEXT, ResolverRolesAdmin.SET_TEXT,
  ResolverRoles.CLEAR, ResolverRolesAdmin.CLEAR,
)
const CHILD_ROLES = combineRoles(
  RegistryRoles.SET_RESOLVER, RegistryRolesAdmin.SET_RESOLVER,
  RegistryRoles.SET_SUBREGISTRY, RegistryRolesAdmin.SET_SUBREGISTRY,
  RegistryRoles.RENEW, RegistryRolesAdmin.RENEW,
)

/** What a namespace should look like on chain once this is done. */
export type Staged = { name: string; contenthash: Hex | null; access: string | null }

/**
 * Contracts deployed by an earlier step and not yet linked, so they are not
 * deployed twice: the root's resolver, the root's registry for its children,
 * and — for deeper names — the registry each parent name holds its children in.
 */
export type Deployed = { resolver?: Address; registry?: Address; registries?: Record<string, Address> }

export type StepKind = 'deploy-resolver' | 'deploy-registry' | 'set-resolver' | 'set-subregistry' | 'set-parent' | 'register' | 'publish'

export type Step = {
  kind: StepKind
  /** Plain words for the wallet prompt the person is about to see. */
  label: string
  to: Address
  data: Hex
  /** A deploy step's future address, recorded so a retry does not deploy again. `name` is set for a nested name's registry. */
  deploys?: { role: 'resolver' | 'registry'; address: Address; name?: string }
  /** Namespaces a publish step writes. */
  names?: string[]
}

export type NamespaceChain = {
  name: string
  registered: boolean
  resolver: Address | null
  contenthash: Hex | null
  access: string | null
  /** True when the chain already says what is staged. */
  current: boolean
}

export type Plan = {
  root: string
  owner: Address
  /** The next transaction, or null when the chain matches what is staged. */
  step: Step | null
  /** Rough count of one-time setup transactions still ahead, for a progress bar. */
  setupRemaining: number
  namespaces: NamespaceChain[]
}

export class PlanError extends Error {
  constructor(message: string) { super(message); this.name = 'PlanError' }
}

async function hasCode(client: PublicClient, address: Address | undefined): Promise<boolean> {
  if (!address) return false
  const code = await client.getCode({ address }).catch(() => undefined)
  return !!code && code !== '0x'
}

async function readRecords(client: PublicClient, resolver: Address, name: string): Promise<{ contenthash: Hex | null; access: string | null }> {
  const node = namehash(name)
  const [ch, text] = await Promise.all([
    client.readContract({ address: resolver, abi: abis.resolver, functionName: 'contenthash', args: [node] }).catch(() => '0x'),
    client.readContract({ address: resolver, abi: abis.resolver, functionName: 'text', args: [node, ACCESS_TEXT_KEY] }).catch(() => ''),
  ]) as [Hex, string]
  return { contenthash: ch && ch !== '0x' ? ch : null, access: text || null }
}

/** Simulate as the owner so a step that would revert is reported here, not in the wallet. */
async function simulate(client: PublicClient, owner: Address, step: Step): Promise<Step> {
  try {
    await client.call({ account: owner, to: step.to, data: step.data })
    return step
  } catch (e) {
    const reason = e instanceof Error ? (e as { shortMessage?: string }).shortMessage ?? e.message : String(e)
    throw new PlanError(`${step.label} would revert: ${reason.slice(0, 200)}`)
  }
}

let saltSeq = 0n
async function deployStep(client: PublicClient, owner: Address, role: 'resolver' | 'registry', name?: string): Promise<Step> {
  const implementation = role === 'resolver' ? addresses.permissionedResolverImpl : addresses.userRegistryImpl
  const init = role === 'resolver'
    ? encodeFunctionData({ abi: abis.resolver, functionName: 'initialize', args: [owner, OWNER_RESOLVER_ROLES, []] })
    : encodeFunctionData({ abi: abis.registry, functionName: 'initialize', args: [owner, OWNER_REGISTRY_ROLES] })
  // Several registries can be deployed in one batch, so every salt is distinct.
  const salt = BigInt(Date.now()) * 1000n + (saltSeq++ % 1000n)
  const { result } = await client.simulateContract({
    account: owner, address: addresses.verifiableFactory, abi: abis.verifiableFactory, functionName: 'deployProxy', args: [implementation, salt, init],
  })
  return {
    kind: role === 'resolver' ? 'deploy-resolver' : 'deploy-registry',
    label: role === 'resolver' ? 'Create the resolver your namespaces will share' : name ? `Create a registry for names under ${name}` : 'Create the registry your namespaces will live in',
    to: addresses.verifiableFactory,
    data: encodeFunctionData({ abi: abis.verifiableFactory, functionName: 'deployProxy', args: [implementation, salt, init] }),
    deploys: { role, address: getAddress(result as Address), ...(name ? { name } : {}) },
  }
}

// ---------------------------------------------------------------------------
// Planning — any depth
// ---------------------------------------------------------------------------

export type BatchCall = { to: Address; data: Hex; label: string; kind: StepKind; deploys?: Step['deploys']; names?: string[] }

export type Batch = {
  root: string
  owner: Address
  /** Every call still needed, in order. Empty when the chain is current. */
  calls: BatchCall[]
  /** Contracts the batch deploys, at the addresses the factory will give them. */
  deploys: Deployed
}

const depth = (name: string) => name.split('.').length
const parentOf = (name: string) => name.slice(name.indexOf('.') + 1)
const firstLabel = (name: string) => name.slice(0, name.indexOf('.'))

/**
 * The whole remaining sequence, as calls in dependency order.
 *
 * ENSv2 names nest to any depth: a name can have children once it has its own
 * subregistry. So `japan.travel.you.eth` needs `travel.you.eth` to exist *and*
 * to hold a registry of its own, and that registry to be registered in
 * `you.eth`'s. This walks from the root down, registering every name on the
 * way — the namespaces and the parents between them — and giving a registry to
 * each name that has children below it. Every name shares the root's resolver,
 * because records are keyed by namehash; that is what lets one multicall
 * publish every namespace at any depth.
 *
 * Nothing here needs to be discovered mid-way: the factory's addresses are
 * predictable before the deploys run, so the list can be sent as one batch
 * (EIP-5792) or one call at a time. If any call in a batch reverts, the wallet
 * reverts all of them.
 */
export async function planBatch(client: PublicClient, input: { root: string; owner: Address; staged: Staged[]; deployed?: Deployed }): Promise<Batch> {
  const { root } = input
  const owner = getAddress(input.owner)
  const reuse = input.deployed ?? {}
  const { label, parent } = splitName(root)
  if (parent !== 'eth') throw new PlanError(`${root} is not a .eth name`)

  const onChainOwner = await findOwner(client, root).catch(() => zeroAddress)
  if (BigInt(onChainOwner) === 0n) throw new PlanError(`${root} is not registered on Sepolia`)
  if (getAddress(onChainOwner) !== owner) throw new PlanError(`${root} is owned by ${onChainOwner}, not by the connected wallet ${owner}`)

  const ethRegistry = await getEthRegistry(client)
  const calls: BatchCall[] = []
  const deploys: Deployed = {}
  const fresh = new Set<string>() // registries this batch creates: nothing is in them yet
  const staged = input.staged.filter((s) => s.name === root || s.name.endsWith(`.${root}`))

  // ---- the root: a resolver, and a registry for what is under it ----
  let resolver = (await findResolver(client, root)).resolver
  const freshResolver = BigInt(resolver) === 0n && !(await hasCode(client, reuse.resolver))
  if (BigInt(resolver) === 0n) {
    if (await hasCode(client, reuse.resolver)) resolver = reuse.resolver!
    else {
      const d = await deployStep(client, owner, 'resolver')
      resolver = d.deploys!.address
      deploys.resolver = resolver
      calls.push({ ...d, kind: 'deploy-resolver' })
    }
    calls.push({ kind: 'set-resolver', to: ethRegistry, label: `Point ${root} at its resolver`, data: encodeFunctionData({ abi: abis.ethRegistry, functionName: 'setResolver', args: [BigInt(keccakLabel(label)), resolver] }) })
  }

  const regOf = new Map<string, Address>()
  const needsChildren = staged.some((s) => s.name !== root)
  if (needsChildren) {
    let children = await getSubregistry(client, ethRegistry, label)
    if (BigInt(children) === 0n) {
      if (await hasCode(client, reuse.registry)) children = reuse.registry!
      else {
        const d = await deployStep(client, owner, 'registry')
        children = d.deploys!.address
        deploys.registry = children
        fresh.add(children.toLowerCase())
        calls.push({ ...d, kind: 'deploy-registry' })
      }
      calls.push({ kind: 'set-subregistry', to: ethRegistry, label: `Let ${root} have namespaces under it`, data: encodeFunctionData({ abi: abis.ethRegistry, functionName: 'setSubregistry', args: [BigInt(keccakLabel(label)), children] }) })
    }
    const linked = fresh.has(children.toLowerCase()) ? false : await client.readContract({ address: children, abi: abis.registry, functionName: 'getParent' })
      .then((r) => BigInt((r as [Address, string])[0]) !== 0n).catch(() => false)
    if (!linked) calls.push({ kind: 'set-parent', to: children, label: `Link the registry back to ${root}`, data: encodeFunctionData({ abi: abis.registry, functionName: 'setParent', args: [ethRegistry, label] }) })
    regOf.set(root, children)
  }

  // ---- every name between the root and each namespace, shallowest first ----
  const needed = new Set<string>()
  for (const s of staged) {
    for (let n = s.name; n !== root && n.endsWith(`.${root}`); n = parentOf(n)) needed.add(n)
  }
  const hasKids = new Set([...needed].map(parentOf).filter((p) => p !== root && needed.has(p)))
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60)
  const onOtherResolver = new Set<string>()

  for (const name of [...needed].sort((a, b) => depth(a) - depth(b))) {
    const parentReg = regOf.get(parentOf(name))!
    const childLabel = firstLabel(name)
    const inFresh = fresh.has(parentReg.toLowerCase())
    const nameOwner = inFresh ? zeroAddress : await findOwner(client, name).catch(() => zeroAddress)
    const registered = BigInt(nameOwner) !== 0n
    if (registered && getAddress(nameOwner) !== owner) throw new PlanError(`${name} is owned by ${nameOwner}`)

    // A name with children below it needs its own registry.
    let sub: Address = zeroAddress
    if (hasKids.has(name)) {
      const existing = registered ? await getSubregistry(client, parentReg, childLabel) : zeroAddress
      if (BigInt(existing) !== 0n) sub = existing
      else if (await hasCode(client, reuse.registries?.[name])) sub = reuse.registries![name]!
      else {
        const d = await deployStep(client, owner, 'registry', name)
        sub = d.deploys!.address
        deploys.registries = { ...(deploys.registries ?? {}), [name]: sub }
        fresh.add(sub.toLowerCase())
        calls.push({ ...d, kind: 'deploy-registry' })
      }
      regOf.set(name, sub)
    }

    if (!registered) {
      calls.push({ kind: 'register', to: parentReg, label: `Register ${name}`, data: encodeFunctionData({ abi: abis.registry, functionName: 'register', args: [childLabel, owner, sub, resolver, CHILD_ROLES, expiry] }) })
    } else if (hasKids.has(name) && fresh.has(sub.toLowerCase())) {
      calls.push({ kind: 'set-subregistry', to: parentReg, label: `Let ${name} have names under it`, data: encodeFunctionData({ abi: abis.registry, functionName: 'setSubregistry', args: [BigInt(keccakLabel(childLabel)), sub] }) })
    }
    if (hasKids.has(name) && fresh.has(sub.toLowerCase())) {
      calls.push({ kind: 'set-parent', to: sub, label: `Link ${name}'s registry back to it`, data: encodeFunctionData({ abi: abis.registry, functionName: 'setParent', args: [parentReg, childLabel] }) })
    }
    if (registered) {
      const r = (await findResolver(client, name)).resolver
      if (BigInt(r) !== 0n && getAddress(r) !== getAddress(resolver)) onOtherResolver.add(name)
    }
  }

  // ---- the publish: every staged namespace on the shared resolver, one multicall ----
  const writes: Hex[] = []
  const names: string[] = []
  for (const s of staged) {
    if (onOtherResolver.has(s.name)) continue // a namespace on another resolver publishes on its own
    const rec = freshResolver ? { contenthash: null, access: null } : await readRecords(client, resolver, s.name)
    const node = namehash(s.name)
    let touched = false
    if (s.contenthash && (rec.contenthash ?? '').toLowerCase() !== s.contenthash.toLowerCase()) {
      writes.push(encodeFunctionData({ abi: abis.resolver, functionName: 'setContenthash', args: [node, s.contenthash] }))
      touched = true
    }
    if ((rec.access ?? null) !== (s.access ?? null)) {
      writes.push(encodeFunctionData({ abi: abis.resolver, functionName: 'setText', args: [node, ACCESS_TEXT_KEY, s.access ?? ''] }))
      touched = true
    }
    if (touched) names.push(s.name)
  }
  if (writes.length) {
    calls.push({
      kind: 'publish', to: resolver, names,
      label: names.length === 1 ? `Publish ${names[0]}` : `Publish ${names.length} namespaces in one transaction`,
      data: encodeFunctionData({ abi: abis.resolver, functionName: 'multicall', args: [writes] }),
    })
  }
  return { root, owner, calls, deploys }
}

/** Where each staged namespace stands on chain, at any depth. */
async function statusOf(client: PublicClient, root: string, staged: Staged[]): Promise<NamespaceChain[]> {
  return Promise.all(staged.map(async (s) => {
    const registered = s.name === root || BigInt(await findOwner(client, s.name).catch(() => zeroAddress)) !== 0n
    // An unregistered name resolves through its parent's resolver, so only a registered one has records of its own.
    const r = registered ? (await findResolver(client, s.name)).resolver : zeroAddress
    const resolver = BigInt(r) !== 0n ? r : null
    const rec = resolver ? await readRecords(client, resolver, s.name) : { contenthash: null, access: null }
    const current = registered && !!resolver
      && (rec.contenthash ?? '').toLowerCase() === (s.contenthash ?? '').toLowerCase()
      && (rec.access ?? null) === (s.access ?? null)
    return { name: s.name, registered, resolver, ...rec, current }
  }))
}

/**
 * The next single transaction, for wallets that cannot batch.
 *
 * It is the first call of the full plan, simulated as the owner so a step that
 * would revert is reported here rather than in the wallet. Asked again after it
 * lands, the plan is recomputed from the chain, so an interrupted run resumes.
 */
export async function planNext(client: PublicClient, input: { root: string; owner: Address; staged: Staged[]; deployed?: Deployed }): Promise<Plan> {
  const owner = getAddress(input.owner)
  const [batch, namespaces] = await Promise.all([planBatch(client, input), statusOf(client, input.root, input.staged)])
  const first = batch.calls[0]
  let step: Step | null = null
  if (first) {
    const s: Step = { kind: first.kind, label: first.label, to: first.to, data: first.data, ...(first.deploys ? { deploys: first.deploys } : {}), ...(first.names ? { names: first.names } : {}) }
    // A deploy was simulated when it was planned; every other call is simulated now.
    step = first.kind.startsWith('deploy-') ? s : await simulate(client, owner, s)
  }
  return { root: input.root, owner, step, setupRemaining: batch.calls.filter((c) => c.kind !== 'publish').length, namespaces }
}
