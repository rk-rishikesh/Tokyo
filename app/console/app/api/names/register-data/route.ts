/**
 * The calldata for the reveal half of registration.
 *
 * `register` takes eight arguments including a payment token and two addresses,
 * which is more than hand-rolled encoding should attempt. viem encodes it here
 * and the browser sends it — the transaction is still the person's, and this
 * server never holds a key.
 */
import { NextResponse } from 'next/server'
import { abis, addresses } from '@knowledge01/core'
import { encodeFunctionData, zeroAddress, zeroHash, type Hex } from 'viem'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const { address, label, secret, duration } = (await req.json()) as Record<string, string | undefined>
  if (!address || !label || !secret || !duration) {
    return NextResponse.json({ error: 'address, label, secret and duration are required' }, { status: 400 })
  }
  try {
    const data = encodeFunctionData({
      abi: abis.ethRegistrar,
      functionName: 'register',
      args: [
        label,
        address as Hex,
        secret as Hex,
        // No subregistry and no resolver yet: those are attached once the name
        // is actually won, and deploying them first would spend gas on a name
        // that might not be.
        zeroAddress,
        zeroAddress,
        BigInt(duration),
        addresses.stablecoin,
        zeroHash,
      ],
    })
    return NextResponse.json({ data })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'could not encode' }, { status: 500 })
  }
}
