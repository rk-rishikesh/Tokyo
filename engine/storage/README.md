# @k01/storage

IPFS storage and ENS contenthash encoding for a knowledge network.

Two jobs: put a snapshot somewhere immutable, and encode the pointer so ENS can
carry it. Everything goes through one adapter interface, so a namespace does not
know whether it is stored on Pinata, on a Bee node, or in memory for a test.

```bash
npm i @k01/storage
```

## Adapters

```ts
import { pinataAdapter, memoryAdapter } from '@k01/storage'

const storage = process.env.PINATA_JWT
  ? pinataAdapter({ jwt: process.env.PINATA_JWT, gateway: process.env.PINATA_GATEWAY })
  : memoryAdapter()

const { cid } = await storage.put(snapshot)
const back = await storage.get(cid)
```

Public namespaces may store plaintext; private ones are encrypted with a content
key before they leave the machine, so the pinning service holds bytes it cannot
read.

## Contenthash

ENS stores a contenthash, not a URL. Encoding it by hand is a good way to
publish a pointer that resolves nowhere, so this does it with
`@ensdomains/content-hash` against an allow-list, and round-trips every value
before returning it.

```ts
import { encodeContenthash, decodeContenthash } from '@k01/storage'

const hex = encodeContenthash(`ipfs://${cid}`)
decodeContenthash(hex) // ipfs://bafy… — and it threw if it would not have
```

## Related

- [`@k01/core`](../core) — what is being stored
- [`@k01/repo`](../repo) — what decides when to store it

MIT
