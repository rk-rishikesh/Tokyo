import { it } from 'vitest'
import { config } from 'dotenv'
config({ path: '../../.env' })
import { extractFromBrowsing, llmConfig } from '../src/llm.js'
it('live', { timeout: 120_000 }, async () => {
  const cfg = llmConfig()!
  console.log(`model: ${cfg.model} | fallbacks: ${cfg.fallbacks?.join(', ')}`)
  const rows = [
    { host: 'www.loops.house', title: 'Loops House For AI-native hackathons', visits: 10208, urls: 668 },
    { host: 'rust-lang.org', title: 'Rust Programming Language', visits: 210, urls: 64 },
    { host: 'mail.google.com', title: 'Inbox (22,185)', visits: 1310, urls: 450 },
    { host: 'modal.com', title: 'Modal · Serverless GPU compute', visits: 180, urls: 52 },
  ]
  try {
    const out = await extractFromBrowsing(rows, cfg)
    console.log(`RESULT ${out.length} claims:`)
    for (const f of out) console.log(`  • [${f.topic}] ${f.text}  ||  ${f.evidence}`)
  } catch (e) { console.log('ERROR:', e instanceof Error ? e.message : e) }
})
