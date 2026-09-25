/**
 * The chain-backed Pointer: `contenthash` on the namespace's resolver.
 *
 * Reads go through the Universal Resolver. Writes need the resolver address
 * (discovered by walking the name) and a wallet holding ROLE_SET_CONTENTHASH.
 */
import { abis, findResolver, getContenthash } from '@k01/core'
import { namehash, type Address, type Hex, type PublicClient, type WalletClient } from 'viem'
import type { Pointer } from './remote.js'

export class EnsPointer implements Pointer {
  constructor(
    private readonly namespace: string,
    private readonly publicClient: PublicClient,
    private readonly wallet?: WalletClient,
  ) {}

  async read(): Promise<Hex | null> {
    try {
      const ch = await getContenthash(this.publicClient, this.namespace)
      return ch === '0x' ? null : ch
    } catch {
      return null
    }
  }

  async resolverAddress(): Promise<Address> {
    const { resolver } = await findResolver(this.publicClient, this.namespace)
    if (BigInt(resolver) === 0n) throw new Error(`${this.namespace} is not registered on chain — run \`knowledge init ${this.namespace} --register\` first. Commits stay safely local until then.`)
    return resolver
  }

  async write(contenthash: Hex): Promise<string> {
    if (!this.wallet?.account) throw new Error('push needs a wallet: set PRIVATE_KEY')
    const resolver = await this.resolverAddress()
    const hash = await this.wallet.writeContract({
      account: this.wallet.account,
      chain: this.wallet.chain,
      address: resolver,
      abi: abis.resolver,
      functionName: 'setContenthash',
      args: [namehash(this.namespace), contenthash],
    } as never)
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') throw new Error(`setContenthash reverted (${hash})`)
    return hash
  }
}
