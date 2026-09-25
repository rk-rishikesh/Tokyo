/**
 * Connecting an ENS name as your memory.
 *
 * Signing in with a provider says who you are to *this* app. Signing in with a
 * wallet says something stronger: that you control a name, and therefore that
 * the claims written under it are yours in a way no host can revoke. That is the
 * difference between a namespace the demo lends you and one you own.
 *
 * Two steps, and both are necessary:
 *
 *   1. A signature proves control of an address. Nothing more — an address by
 *      itself is not a namespace.
 *   2. An on-chain read proves that address owns the name. This is the half
 *      that cannot be faked, and it is why the check happens here on the server
 *      rather than being reported by the browser.
 */
import { createPublicClient, http, verifyMessage, type Address } from 'viem'
import { sepolia } from 'viem/chains'
import { findOwner } from '@recall/core/resolve'

/** The text a wallet is asked to sign. Human-readable, scoped, and single-use. */
export function challengeMessage(opts: { address: string; name: string; nonce: string; domain: string; issuedAt?: string }): string {
  const issued = opts.issuedAt ?? new Date().toISOString()
  return [
    `${opts.domain} wants you to connect ${opts.name} as your memory.`,
    '',
    'Claims written by the agents you connect will live under namespaces of this name,',
    'and stay yours if you stop using this site.',
    '',
    'This signature proves you control the wallet. It authorises no transaction',
    'and costs nothing.',
    '',
    `Address: ${opts.address}`,
    `Name: ${opts.name}`,
    `Nonce: ${opts.nonce}`,
    `Issued At: ${issued}`,
  ].join('\n')
}

const client = () =>
  createPublicClient({
    chain: sepolia,
    transport: http(process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'),
  })

export type Verification =
  | { ok: true; address: Address; name: string }
  | { ok: false; reason: string }

/**
 * Check a signed challenge, then check the chain.
 *
 * A valid signature over the right message is necessary but not sufficient:
 * anyone can sign a message naming a name they do not own. Only the registry
 * settles that, so a signature that verifies but does not match the on-chain
 * owner is rejected — with the owner named, because "you signed with the wrong
 * wallet" is the likeliest cause and the most useful thing to say.
 */
export async function verifyNameControl(opts: {
  address: string
  name: string
  signature: string
  message: string
  expectedNonce: string
}): Promise<Verification> {
  if (!opts.message.includes(`Nonce: ${opts.expectedNonce}`)) {
    return { ok: false, reason: 'this signing request did not start here — try again' }
  }
  if (!opts.message.includes(`Name: ${opts.name}`) || !opts.message.includes(`Address: ${opts.address}`)) {
    return { ok: false, reason: 'the signed message does not match what was requested' }
  }

  let valid = false
  try {
    valid = await verifyMessage({
      address: opts.address as Address,
      message: opts.message,
      signature: opts.signature as `0x${string}`,
    })
  } catch {
    return { ok: false, reason: 'that signature could not be read' }
  }
  if (!valid) return { ok: false, reason: 'that signature does not match the address' }

  let owner: Address
  try {
    owner = await findOwner(client(), opts.name)
  } catch {
    return { ok: false, reason: `${opts.name} could not be resolved — is it registered on Sepolia?` }
  }
  if (owner.toLowerCase() !== opts.address.toLowerCase()) {
    return { ok: false, reason: `${opts.name} is owned by ${owner}, not by the wallet that signed` }
  }
  return { ok: true, address: opts.address as Address, name: opts.name }
}
