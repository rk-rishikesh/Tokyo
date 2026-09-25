export * from './types.js'
export * from './contenthash.js'
export * from './pinata.js'
export * from './swarm.js'
export * from './memory.js'
export * from './file.js'

import { PinataAdapter } from './pinata.js'
import { SwarmAdapter } from './swarm.js'
import { MemoryAdapter } from './memory.js'
import type { StorageAdapter } from './types.js'

export type StorageBackend = 'pinata' | 'swarm' | 'memory'

/**
 * Build the adapter named by `RECALL_STORAGE`.
 *
 * All storage access goes through the adapter interface (rule 7) — no direct
 * Pinata or Bee calls anywhere else in the tree.
 */
export function createStorage(
  backend: StorageBackend = (process.env.RECALL_STORAGE as StorageBackend) ?? 'pinata',
  env: NodeJS.ProcessEnv = process.env,
): StorageAdapter {
  switch (backend) {
    case 'pinata':
      return new PinataAdapter({
        // Absent for a read-only subscriber; required only when publishing.
        ...(env.PINATA_JWT ? { jwt: env.PINATA_JWT } : {}),
        gateway: env.PINATA_GATEWAY ?? '',
      })
    case 'swarm':
      return new SwarmAdapter({
        apiUrl: env.BEE_API_URL ?? 'http://localhost:1633',
        postageBatchId: env.BEE_POSTAGE_BATCH_ID ?? '',
      })
    case 'memory':
      return new MemoryAdapter()
    default:
      throw new Error(`Unknown RECALL_STORAGE backend "${backend}"`)
  }
}
