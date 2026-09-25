/**
 * The acceptance test the whole design answers to.
 *
 * Agent A writes a person's memory. Agent B is a different program with its own
 * key that has never seen A's storage. The person grants B one namespace. Then
 * A's company is deleted — its entire directory — and B, and the person, still
 * read what was learned, from the network alone.
 *
 * Nothing here gives B a Repository, a RepoStore, or a path inside A's
 * directory. B's only inputs are the network directory and its private key.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { decodeObject, publicKeyFromPrivate, unwrapKey } from '@recall/core'
import {
  AccessDenied, OWNER_KEY_MESSAGE, Repository, grantAccess, localNetwork, ownerKeyFromSignature,
  readManifest, resolveNamespace, revokeAccess,
} from '../src/index.js'

const source = (name: string) => [{ type: 'observation' as const, kind: 'application' as const, name }]

describe('delete the company', () => {
  it('memory written by Agent A is read by Agent B and the owner after A is gone', async () => {
    const root = mkdtempSync(join(tmpdir(), 'knowledge-dtc-'))
    const companyA = join(root, 'agent-a') // everything Agent A's company owns
    const netDir = join(root, 'network') // IPFS + ENS, owned by nobody here
    process.env.RECALL_CACHE_DIR = companyA

    // ---- Agent A learns, in two namespaces the person owns ---------------------
    const netA = localNetwork(netDir)
    const food = Repository.init('food.rishikesh.eth', 'rishikesh.eth', { contentKey: 'a1'.repeat(32) })
    food.remember({ claim: 'Orders from Dishoom most weeks', subject: 'Food', topic: 'food', sources: source('Google Takeout') })
    food.remember({ claim: 'Never orders after 9pm', subject: 'Food', topic: 'food', sources: source('Google Takeout') })
    const work = Repository.init('work.rishikesh.eth', 'rishikesh.eth', { contentKey: 'b2'.repeat(32) })
    work.remember({ claim: 'Works on loops-platform', subject: 'Projects', topic: 'projects', sources: source('GitHub') })

    // The owner's recovery key: derived from a wallet signature, never stored.
    const wallet = privateKeyToAccount(generatePrivateKey())
    const ownerKey = ownerKeyFromSignature(await wallet.signMessage({ message: OWNER_KEY_MESSAGE('rishikesh.eth') }))
    for (const repo of [food, work]) await grantAccess(repo, netA, { agent: 'owner', pubkey: ownerKey.pubkey, owner: true })

    // ---- Agent B: its own key, granted food only ------------------------------
    const agentB = { privateKey: generatePrivateKey() }
    await grantAccess(food, netA, { agent: 'Agent B', pubkey: publicKeyFromPrivate(agentB.privateKey) })

    // ---- The company is deleted ----------------------------------------------
    rmSync(companyA, { recursive: true, force: true })
    expect(existsSync(companyA)).toBe(false)

    // B opens the network fresh — a new process would do exactly this.
    const netB = localNetwork(netDir)
    const seen = await resolveNamespace(netB, 'food.rishikesh.eth', agentB)
    expect(seen.claims.map((c) => c.claim).sort()).toEqual(['Never orders after 9pm', 'Orders from Dishoom most weeks'])
    expect(seen.claims.every((c) => c.sources[0]?.name === 'Google Takeout')).toBe(true)
    expect(seen.version).toBe(2)
    expect(seen.readers).toBe('key')

    // Scoping is cryptographic: B holds no key for work.
    await expect(resolveNamespace(netB, 'work.rishikesh.eth', agentB)).rejects.toBeInstanceOf(AccessDenied)
    await expect(resolveNamespace(netB, 'food.rishikesh.eth', null)).rejects.toBeInstanceOf(AccessDenied)

    // The owner recovers both, from a signature alone.
    const again = ownerKeyFromSignature(await wallet.signMessage({ message: OWNER_KEY_MESSAGE('rishikesh.eth') }))
    expect(again.privateKey).toBe(ownerKey.privateKey)
    const mine = await resolveNamespace(netB, 'work.rishikesh.eth', { privateKey: again.privateKey })
    expect(mine.claims[0]?.claim).toBe('Works on loops-platform')

    rmSync(root, { recursive: true, force: true })
  })

  it('revoking re-keys, so the old key opens nothing published after', async () => {
    const root = mkdtempSync(join(tmpdir(), 'knowledge-dtc-'))
    process.env.RECALL_CACHE_DIR = join(root, 'agent-a')
    const net = localNetwork(join(root, 'network'))

    const food = Repository.init('food.me.eth', 'me.eth', { contentKey: 'c3'.repeat(32) })
    food.remember({ claim: 'Vegetarian on weekdays', subject: 'Food', topic: 'food', sources: source('Google Takeout') })
    const b = { privateKey: generatePrivateKey() }
    const c = { privateKey: generatePrivateKey() }
    await grantAccess(food, net, { agent: 'B', pubkey: publicKeyFromPrivate(b.privateKey) })
    await grantAccess(food, net, { agent: 'C', pubkey: publicKeyFromPrivate(c.privateKey) })

    // B keeps a copy of its key before the revoke, as a misbehaving agent would.
    const before = await readManifest(net, 'food.me.eth')
    const bGrant = before!.grants.find((g) => g.agent === 'B')!
    const bOldKey = unwrapKey(bGrant.wrappedKey!, b.privateKey)

    const after = await revokeAccess(food, net, publicKeyFromPrivate(b.privateKey))
    expect(after.keyVersion).toBe(before!.keyVersion + 1)
    expect(after.grants.map((g) => g.agent)).toEqual(['C'])

    food.remember({ claim: 'Started eating fish in September', subject: 'Food', topic: 'food', sources: source('Google Takeout') })
    await grantAccess(food, net, { agent: 'C', pubkey: publicKeyFromPrivate(c.privateKey) }) // publishes

    await expect(resolveNamespace(net, 'food.me.eth', b)).rejects.toBeInstanceOf(AccessDenied)
    const ch = await net.records('food.me.eth').read()
    await expect(net.storage.get(net.storage.fromContenthash(ch!), { contentKey: bOldKey }).then(decodeObject)).rejects.toThrow()

    const cSees = await resolveNamespace(net, 'food.me.eth', c)
    expect(cSees.claims.map((k) => k.claim)).toContain('Started eating fish in September')

    rmSync(root, { recursive: true, force: true })
  })
})
