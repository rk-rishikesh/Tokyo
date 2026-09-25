/**
 * Build (and optionally publish) a seeded collection document.
 *
 * Without `--publish` this writes the collection JSON to disk so it can be reviewed
 * and passed to `deploy-collection.ts --seed`. With `--publish` it encrypts and
 * stores the document through the configured adapter and prints the ref and
 * contenthash, without touching the chain.
 *
 * Run: pnpm seed --collection exploits.auditor.eth --out seed.json
 */
import 'dotenv/config'
import { writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import {
  emptyCollection,
  generateContentKey,
  serialiseCollection,
  validateCollection,
  type Collection,
} from '@k01/core'
import { createStorage } from '@k01/storage'
import { seedSkills } from './seed/skills.js'
import { DESCRIPTION, README, TITLE } from './seed/about.js'

const { values } = parseArgs({
  options: {
    collection: { type: 'string', default: 'exploits.auditor.eth' },
    out: { type: 'string', default: 'seed.json' },
    publish: { type: 'boolean', default: false },
    storage: { type: 'string', default: process.env.RECALL_STORAGE ?? 'pinata' },
    author: { type: 'string' },
    block: { type: 'string', default: '0' },
  },
})

async function main() {
  const mergedAt = Number(values.block)
  const collection: Collection = {
    ...emptyCollection(values.collection!),
    readme: README,
    entries: seedSkills.map((e) => ({
      ...e,
      mergedAt,
      ...(values.author ? { author: values.author as `0x${string}` } : {}),
    })),
  }

  // Validate before anything else: a seed that fails the schema would fail at
  // read time in front of an audience instead.
  validateCollection(collection)
  const bytes = serialiseCollection(collection)

  console.log(`\nSeed collection for ${collection.collection}`)
  console.log(`  title:   ${TITLE}`)
  console.log(`  entries: ${collection.entries.length}`)
  console.log(`  readme:  ${README.length} chars`)
  console.log(`  bytes:   ${bytes.length}`)
  const tags = new Map<string, number>()
  for (const e of collection.entries) for (const t of e.tags) tags.set(t, (tags.get(t) ?? 0) + 1)
  console.log(
    `  tags:    ${[...tags.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([t, n]) => `${t}(${n})`)
      .join(' ')}`,
  )

  if (!values.publish) {
    writeFileSync(values.out!, new TextDecoder().decode(bytes))
    console.log(`\nWrote ${values.out}`)
    console.log('\nPublish the public description alongside it:')
    console.log(`  title:       ${TITLE}`)
    console.log(`  description: ${DESCRIPTION.slice(0, 80)}…`)
    console.log(`Publish it with: pnpm deploy:collection --collection <label> --publisher <name.eth> --seed ${values.out}\n`)
    return
  }

  const contentKey = generateContentKey()
  const storage = createStorage(values.storage as 'pinata' | 'swarm' | 'memory')
  const ref = await storage.put(bytes, { collection: collection.collection, contentKey })

  console.log(`\nPublished to ${values.storage}`)
  console.log(`  ref:         ${ref.ref}`)
  console.log(`  contenthash: ${storage.toContenthash(ref)}`)
  console.log(`  contentKey:  0x${Buffer.from(contentKey).toString('hex')}`)
  console.log('\nNothing was written to chain. Set the contenthash with deploy-collection.ts.\n')
}

main().catch((e) => {
  console.error('\nseed-entries failed:', e)
  process.exit(1)
})
