/**
 * Everything the browser needs to register a name itself.
 *
 * The transactions are sent by the person's own wallet, not by this server —
 * which is the point. A host that registered names on someone's behalf would
 * hold the keys to them, and the whole argument is that the name is theirs.
 *
 * So this returns addresses, ABI fragments, the price and a freshly generated
 * secret; the browser does the rest. ENSv2 registration is commit-reveal, so it
 * is two transactions with a mandatory wait between them. The wait is
 * front-running protection and cannot be skipped.
 */
import { randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { abis, addresses } from '@recall/core'
import { client, statusOf } from '@recall/connect'
import { toHex, zeroAddress, zeroHash, type Hex } from 'viem'

export const dynamic = 'force-dynamic'

/** One year. Long enough that a demo name outlives the demo. */
const DURATION = 31_536_000n

export async function POST(req: Request) {
  const { address, name } = (await req.json()) as { address?: string; name?: string }
  if (!address || !name) return NextResponse.json({ error: 'address and name are required' }, { status: 400 })

  const label = name.trim().toLowerCase().replace(/\.eth$/, '')
  if (!/^[a-z0-9-]{3,63}$/.test(label)) {
    return NextResponse.json({ error: 'names are 3–63 characters, letters, numbers and hyphens' }, { status: 400 })
  }

  // Refuse before asking anyone to sign: a name already taken cannot be
  // registered, and finding that out from a reverted transaction is a poor way
  // to learn it.
  const status = await statusOf(address, `${label}.eth`)
  if (status.status === 'owned') return NextResponse.json({ error: 'you already own that one — pick it from the list' }, { status: 400 })
  if (status.status === 'taken') return NextResponse.json({ error: `${label}.eth is already registered` }, { status: 400 })

  try {
    const c = client()
    const registrar = addresses.ethRegistrar
    const [base, premium] = (await c.readContract({
      address: registrar,
      abi: abis.ethRegistrar,
      functionName: 'getRegisterPrice',
      args: [label, DURATION, addresses.stablecoin],
    })) as [bigint, bigint]
    const price = base + premium

    // The secret is generated here and held by the browser between the two
    // transactions. It is what ties the reveal to the commitment.
    const secret = toHex(randomBytes(32)) as Hex
    const commitmentArgs = [label, address, secret, zeroAddress, zeroAddress, DURATION, zeroHash] as const
    const commitment = (await c.readContract({
      address: registrar,
      abi: abis.ethRegistrar,
      functionName: 'makeCommitment',
      args: commitmentArgs,
    })) as Hex
    const minAge = (await c.readContract({
      address: registrar,
      abi: abis.ethRegistrar,
      functionName: 'MIN_COMMITMENT_AGE',
    })) as bigint

    return NextResponse.json({
      label,
      name: `${label}.eth`,
      registrar,
      stablecoin: addresses.stablecoin,
      price: price.toString(),
      // Mint comfortably more than the name costs: the same token pays for
      // renewals later, and a second faucet trip mid-demo is avoidable.
      mintAmount: (price * 100n).toString(),
      duration: DURATION.toString(),
      secret,
      commitment,
      waitSeconds: Number(minAge),
      chainId: 11155111,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'could not price that name' }, { status: 502 })
  }
}
