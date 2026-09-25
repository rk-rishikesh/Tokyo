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

/** Contracts deployed by an earlier step and not yet linked, so they are not deployed twice. */
export type Deployed = { resolver?: Address; registry?: Address }

export type StepKind = 'deploy-resolver' | 'deploy-registry' | 'set-resolver' | 'set-subregistry' | 'set-parent' | 'register' | 'publish'

export type Step = {
  kind: StepKind
  /** Plain words for the wallet prompt the person is about to see. */
  label: string
  to: Address
  data: Hex
  /** A deploy step's future address, recorded so a retry does not deploy again. */
  deploys?: { role: 'resolver' | 'registry'; address: Address }
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

async function deployStep(client: PublicClient, owner: Address, role: 'resolver' | 'registry'): Promise<Step> {
  const implementation = role === 'resolver' ? addresses.permissionedResolverImpl : addresses.userRegistryImpl
  const init = role === 'resolver'
    ? encodeFunctionData({ abi: abis.resolver, functionName: 'initialize', args: [owner, OWNER_RESOLVER_ROLES, []] })
    : encodeFunctionData({ abi: abis.registry, functionName: 'initialize', args: [owner, OWNER_REGISTRY_ROLES] })
  const salt = BigInt(Date.now()) * 1000n + (role === 'resolver' ? 1n : 2n)
  const { result } = await client.simulateContract({
    account: owner, address: addresses.verifiableFactory, abi: abis.verifiableFactory, functionName: 'deployProxy', args: [implementation, salt, init],
  })
  return {
    kind: role === 'resolver' ? 'deploy-resolver' : 'deploy-registry',
    label: role === 'resolver' ? 'Create the resolver your namespaces will share' : 'Create the registry your namespaces will live in',
    to: addresses.verifiableFactory,
    data: encodeFunctionData({ abi: abis.verifiableFactory, functionName: 'deployProxy', args: [implementation, salt, init] }),
    deploys: { role, address: getAddress(result as Address) },
  }
}

/**
 * The next transaction that moves the chain toward `staged`.
 *
 * Only children one label below `root` are supported (`food.you.eth`), which
 * is every namespace this product creates. Deeper names are reported as not
 * current rather than guessed at.
 */
export async function planNext(client: PublicClient, input: { root: string; owner: Address; staged: Staged[]; deployed?: Deployed }): Promise<Plan> {
  const { root, staged } = input
  const owner = getAddress(input.owner)
  const deployed = input.deployed ?? {}
  const { label, parent } = splitName(root)
  if (parent !== 'eth') throw new PlanError(`${root} is not a .eth name`)

  const onChainOwner = await findOwner(client, root).catch(() => zeroAddress)
  if (BigInt(onChainOwner) === 0n) throw new PlanError(`${root} is not registered on Sepolia`)
  if (getAddress(onChainOwner) !== owner) throw new PlanError(`${root} is owned by ${onChainOwner}, not by the connected wallet ${owner}`)

  const ethRegistry = await getEthRegistry(client)
  const labelId = BigInt(keccakLabel(label))
  const rootResolver = (await findResolver(client, root)).resolver
  const hasResolver = BigInt(rootResolver) !== 0n
  const children = await getSubregistry(client, ethRegistry, label)
  const hasChildren = BigInt(children) !== 0n
  const parentLinked = hasChildren
    ? await client.readContract({ address: children, abi: abis.registry, functionName: 'getParent' })
      .then((r) => { const [p] = r as [Address, string]; return BigInt(p) !== 0n })
      .catch(() => false)
    : false

  // What each namespace looks like now.
  const namespaces: NamespaceChain[] = await Promise.all(staged.map(async (s) => {
    const direct = s.name.endsWith(`.${root}`) && !s.name.slice(0, -(root.length + 1)).includes('.')
    const isRoot = s.name === root
    let registered = isRoot
    let resolver: Address | null = isRoot && hasResolver ? rootResolver : null
    if (direct && hasChildren) {
      const childOwner = await findOwner(client, s.name).catch(() => zeroAddress)
      registered = BigInt(childOwner) !== 0n
      if (registered && getAddress(childOwner) !== owner) throw new PlanError(`${s.name} is owned by ${childOwner}`)
      if (registered) {
        const r = (await findResolver(client, s.name)).resolver
        resolver = BigInt(r) !== 0n ? r : null
      }
    }
    const rec = resolver ? await readRecords(client, resolver, s.name) : { contenthash: null, access: null }
    const current = registered && !!resolver
      && (rec.contenthash ?? null)?.toLowerCase() === (s.contenthash ?? null)?.toLowerCase()
      && (rec.access ?? null) === (s.access ?? null)
    return { name: s.name, registered, resolver, ...rec, current }
  }))

  const unregistered = namespaces.filter((n) => !n.registered).length
  const setupRemaining = (hasResolver ? 0 : 2) + (hasChildren ? 0 : 2) + (parentLinked ? 0 : 1) + unregistered
  const plan = (step: Step | null): Plan => ({ root, owner, step, setupRemaining, namespaces })

  // ---- one-time: the shared resolver ----
  if (!hasResolver) {
    if (await hasCode(client, deployed.resolver)) {
      return plan(await simulate(client, owner, {
        kind: 'set-resolver', label: `Point ${root} at its resolver`, to: ethRegistry,
        data: encodeFunctionData({ abi: abis.ethRegistry, functionName: 'setResolver', args: [labelId, deployed.resolver!] }),
      }))
    }
    return plan(await deployStep(client, owner, 'resolver'))
  }

  // ---- one-time: somewhere for namespaces to be registered ----
  if (!hasChildren) {
    if (await hasCode(client, deployed.registry)) {
      return plan(await simulate(client, owner, {
        kind: 'set-subregistry', label: `Let ${root} have namespaces under it`, to: ethRegistry,
        data: encodeFunctionData({ abi: abis.ethRegistry, functionName: 'setSubregistry', args: [labelId, deployed.registry!] }),
      }))
    }
    return plan(await deployStep(client, owner, 'registry'))
  }
  if (!parentLinked) {
    return plan(await simulate(client, owner, {
      kind: 'set-parent', label: `Link the registry back to ${root}`, to: children,
      data: encodeFunctionData({ abi: abis.registry, functionName: 'setParent', args: [ethRegistry, label] }),
    }))
  }

  // ---- one-time per namespace ----
  const missing = namespaces.find((n) => !n.registered && n.name.endsWith(`.${root}`))
  if (missing) {
    const childLabel = missing.name.slice(0, -(root.length + 1))
    if (childLabel.includes('.')) throw new PlanError(`${missing.name} is more than one level below ${root}; only direct namespaces are supported`)
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60)
    return plan(await simulate(client, owner, {
      kind: 'register', label: `Register ${missing.name}`, to: children,
      data: encodeFunctionData({ abi: abis.registry, functionName: 'register', args: [childLabel, owner, zeroAddress, rootResolver, CHILD_ROLES, expiry] }),
    }))
  }

  // ---- the publish itself: every stale namespace on one resolver, one transaction ----
  const stale = namespaces.filter((n) => !n.current && n.resolver)
  if (!stale.length) return plan(null)
  const target = stale[0]!.resolver!
  const group = stale.filter((n) => n.resolver && getAddress(n.resolver) === getAddress(target))
  const calls: Hex[] = []
  for (const n of group) {
    const s = staged.find((x) => x.name === n.name)!
    const node = namehash(n.name)
    if ((n.contenthash ?? '').toLowerCase() !== (s.contenthash ?? '').toLowerCase() && s.contenthash) {
      calls.push(encodeFunctionData({ abi: abis.resolver, functionName: 'setContenthash', args: [node, s.contenthash] }))
    }
    if ((n.access ?? null) !== (s.access ?? null)) {
      calls.push(encodeFunctionData({ abi: abis.resolver, functionName: 'setText', args: [node, ACCESS_TEXT_KEY, s.access ?? ''] }))
    }
  }
  if (!calls.length) return plan(null)
  return plan(await simulate(client, owner, {
    kind: 'publish',
    label: group.length === 1 ? `Publish ${group[0]!.name}` : `Publish ${group.length} namespaces in one transaction`,
    to: target,
    data: encodeFunctionData({ abi: abis.resolver, functionName: 'multicall', args: [calls] }),
    names: group.map((n) => n.name),
  }))
}

// ---------------------------------------------------------------------------
// Everything at once, for wallets that batch
// ---------------------------------------------------------------------------

export type Batch = {
  root: string
  owner: Address
  /** Every call still needed, in order. Empty when the chain is current. */
  calls: { to: Address; data: Hex; label: string }[]
  /** Contracts the batch deploys, at the addresses the factory will give them. */
  deploys: { resolver?: Address; registry?: Address }
}

/**
 * The whole remaining sequence as one list of calls, for a wallet that can send
 * them in a single confirmation (EIP-5792 `wallet_sendCalls`).
 *
 * `planNext` works one step at a time because each step is simulated against
 * the state the previous one left, and a batch cannot be simulated that way.
 * What makes a batch possible is that nothing here needs to be discovered: the
 * factory's addresses are predictable before the deploys run (the first deploy
 * is simulated to learn them), and every later call only needs those addresses.
 * If any call in the batch reverts, the wallet reverts all of them.
 */
export async function planBatch(client: PublicClient, input: { root: string; owner: Address; staged: Staged[]; deployed?: Deployed }): Promise<Batch> {
  const { root, staged } = input
  const owner = getAddress(input.owner)
  const { label, parent } = splitName(root)
  if (parent !== 'eth') throw new PlanError(`${root} is not a .eth name`)

  const onChainOwner = await findOwner(client, root).catch(() => zeroAddress)
  if (BigInt(onChainOwner) === 0n) throw new PlanError(`${root} is not registered on Sepolia`)
  if (getAddress(onChainOwner) !== owner) throw new PlanError(`${root} is owned by ${onChainOwner}, not by the connected wallet ${owner}`)

  const ethRegistry = await getEthRegistry(client)
  const labelId = BigInt(keccakLabel(label))
  let resolver = (await findResolver(client, root)).resolver
  let children = await getSubregistry(client, ethRegistry, label)
  const calls: Batch['calls'] = []
  const deploys: Batch['deploys'] = {}

  // A contract deployed by an earlier, interrupted run is reused, not redeployed.
  const reuse = input.deployed ?? {}
  if (BigInt(resolver) === 0n) {
    if (await hasCode(client, reuse.resolver)) {
      resolver = reuse.resolver!
    } else {
      const d = await deployStep(client, owner, 'resolver')
      resolver = d.deploys!.address
      deploys.resolver = resolver
      calls.push({ to: d.to, data: d.data, label: d.label })
    }
    calls.push({ to: ethRegistry, label: `Point ${root} at its resolver`, data: encodeFunctionData({ abi: abis.ethRegistry, functionName: 'setResolver', args: [labelId, resolver] }) })
  }

  const hadChildren = BigInt(children) !== 0n
  if (!hadChildren) {
    if (await hasCode(client, reuse.registry)) {
      children = reuse.registry!
    } else {
      const d = await deployStep(client, owner, 'registry')
      children = d.deploys!.address
      deploys.registry = children
      calls.push({ to: d.to, data: d.data, label: d.label })
    }
    calls.push({ to: ethRegistry, label: `Let ${root} have namespaces under it`, data: encodeFunctionData({ abi: abis.ethRegistry, functionName: 'setSubregistry', args: [labelId, children] }) })
  }
  const parentLinked = hadChildren
    ? await client.readContract({ address: children, abi: abis.registry, functionName: 'getParent' })
      .then((r) => { const [p] = r as [Address, string]; return BigInt(p) !== 0n })
      .catch(() => false)
    : false
  if (!parentLinked) {
    calls.push({ to: children, label: `Link the registry back to ${root}`, data: encodeFunctionData({ abi: abis.registry, functionName: 'setParent', args: [ethRegistry, label] }) })
  }

  // Namespaces: register what is missing, then publish everything stale on the shared resolver.
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60)
  const writes: Hex[] = []
  for (const s of staged) {
    if (s.name !== root && !s.name.endsWith(`.${root}`)) continue
    const childLabel = s.name === root ? null : s.name.slice(0, -(root.length + 1))
    if (childLabel?.includes('.')) continue
    let target = resolver
    if (childLabel) {
      const registered = hadChildren && BigInt(await findOwner(client, s.name).catch(() => zeroAddress)) !== 0n
      if (!registered) {
        calls.push({ to: children, label: `Register ${s.name}`, data: encodeFunctionData({ abi: abis.registry, functionName: 'register', args: [childLabel, owner, zeroAddress, resolver, CHILD_ROLES, expiry] }) })
      } else {
        const r = (await findResolver(client, s.name)).resolver
        if (BigInt(r) !== 0n) target = r
      }
    }
    if (getAddress(target) !== getAddress(resolver)) continue // a namespace on another resolver publishes on its own
    const rec = deploys.resolver ? { contenthash: null, access: null } : await readRecords(client, resolver, s.name)
    const node = namehash(s.name)
    if (s.contenthash && (rec.contenthash ?? '').toLowerCase() !== s.contenthash.toLowerCase()) {
      writes.push(encodeFunctionData({ abi: abis.resolver, functionName: 'setContenthash', args: [node, s.contenthash] }))
    }
    if ((rec.access ?? null) !== (s.access ?? null)) {
      writes.push(encodeFunctionData({ abi: abis.resolver, functionName: 'setText', args: [node, ACCESS_TEXT_KEY, s.access ?? ''] }))
    }
  }
  if (writes.length) {
    calls.push({ to: resolver, label: `Publish ${writes.length} record${writes.length === 1 ? '' : 's'}`, data: encodeFunctionData({ abi: abis.resolver, functionName: 'multicall', args: [writes] }) })
  }

  return { root, owner, calls, deploys }
}
