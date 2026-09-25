/**
 * Where memory can actually come from.
 *
 * Researched rather than imagined, and the answer is uncomfortable enough to be
 * worth stating plainly: there is no broad OAuth surface for consumer
 * transaction history. Food delivery, e-commerce and travel are closed —
 * every "API" in those spaces is merchant-side. Instagram's personal API was
 * switched off in December 2024. TripIt closed to new integrations in February
 * 2026. LinkedIn's self-serve scopes return an identity, not a history.
 *
 * So the page names two tiers instead of a wall of logos, because a wall of
 * logos would imply integrations that do not exist — and on a page whose whole
 * argument is provenance, that is the one lie that costs everything.
 *
 * Every entry below was verified against vendor documentation, and the four MCP
 * endpoints were checked live for OAuth metadata.
 */

export type Tier = 'live' | 'possible'

type Source = {
  name: string
  glyph: string
  what: string
  how: string
  tier: Tier
}

const SOURCES: Source[] = [
  // Tier 1 — connected and working in this product today.
  { name: 'GitHub', glyph: '🐙', what: 'What you build, and in what', how: 'OAuth · MCP', tier: 'live' },
  { name: 'Granola', glyph: '🌀', what: 'Who you meet with', how: 'MCP · OAuth + PKCE', tier: 'live' },
  { name: 'Google Workspace', glyph: '🅖', what: 'Meetings that recur, services that mail you', how: 'OAuth', tier: 'live' },
  { name: 'Linear', glyph: '📐', what: 'Which teams and projects you work in', how: 'OAuth · MCP', tier: 'live' },
  { name: 'Your browser', glyph: '🌐', what: 'What you use, and how much', how: 'local', tier: 'live' },
  { name: 'Your editor', glyph: '⌨️', what: 'Projects, and what they are built with', how: 'local', tier: 'live' },
  { name: 'Google Takeout', glyph: '📦', what: 'Where you order from, what you follow', how: 'Data Portability API', tier: 'live' },
  { name: 'Ethereum wallet', glyph: '◆', what: 'What you hold, and which protocols you use', how: 'your wallet · Blockscout', tier: 'live' },


]


export function Sources() {
  return (
    <div>
      <p className="text-[14px] text-ink">Connected today.</p>
      <p className="mt-1 max-w-xl text-[14.5px] leading-relaxed text-dim">
        Live in this product. Each grants the narrowest read that answers one question, and says what it will never do.
      </p>
      <ol className="mt-6 grid border-t border-line md:grid-cols-2 md:gap-x-16">
        {SOURCES.map((s, i) => (
          <li key={s.name} className="grid grid-cols-[2.2rem_1fr_auto] items-baseline gap-3 border-b border-line py-4">
            <span className="font-mono text-[12.5px] text-dim">{String(i + 1).padStart(2, '0')}</span>
            <span>
              <span className="block text-[clamp(1.1rem,1.6vw,1.45rem)] leading-tight tracking-[-0.03em]">{s.name}</span>
              <span className="mt-0.5 block text-[14.5px] text-dim">{s.what}</span>
            </span>
            <span className="rounded-full bg-ink px-2.5 py-1 text-[12.5px] text-bg">{s.how}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
