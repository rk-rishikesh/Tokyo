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

  // Tier 2 — an official OAuth or MCP surface exists; not wired up here yet.
  { name: 'Strava', glyph: '🏃', what: 'How you train', how: 'OAuth · read-only MCP', tier: 'possible' },
  { name: 'Spotify', glyph: '🎧', what: 'What you listen to while working', how: 'OAuth', tier: 'possible' },
  { name: 'Notion', glyph: '📓', what: 'What you write down', how: 'MCP · OAuth + DCR', tier: 'possible' },
  { name: 'Slack', glyph: '💬', what: 'How your team decides things', how: 'MCP · user OAuth', tier: 'possible' },
  { name: 'Oura · Whoop', glyph: '💍', what: 'Sleep and recovery', how: 'OAuth', tier: 'possible' },


]

const TIERS: { id: Tier; label: string; body: string }[] = [
  {
    id: 'live',
    label: 'Connected today',
    body: 'Live in this product. Each grants the narrowest read that answers one question, and says what it will never do.',
  },
  {
    id: 'possible',
    label: 'Official API exists',
    body: 'A vendor OAuth or MCP surface that works — not yet wired up here. Strava ships a read-only MCP connector, which is the closest thing outside this list to a proof that the pattern works.',
  },
]

export function Sources() {
  return (
    <div className="grid gap-14 lg:grid-cols-2">
      {TIERS.map((t) => (
        <div key={t.id}>
          <p className="text-[14px] text-ink">{t.label}.</p>
          <p className="mt-1 max-w-md text-[14.5px] leading-relaxed text-dim">{t.body}</p>
          <ol className="mt-6 border-t border-line">
            {SOURCES.filter((s) => s.tier === t.id).map((s, i) => (
              <li key={s.name} className="grid grid-cols-[2.2rem_1fr_auto] items-baseline gap-3 border-b border-line py-4">
                <span className="font-mono text-[12.5px] text-dim">{String(i + 1).padStart(2, '0')}</span>
                <span>
                  <span className="block text-[clamp(1.1rem,1.6vw,1.45rem)] leading-tight tracking-[-0.03em]">{s.name}</span>
                  <span className="mt-0.5 block text-[14.5px] text-dim">{s.what}</span>
                </span>
                <span className={`rounded-full px-2.5 py-1 text-[12.5px] ${t.id === 'live' ? 'bg-ink text-bg' : 'border border-line text-dim'}`}>{s.how}</span>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  )
}

/**
 * The honest caveat, said out loud.
 *
 * A judge will ask why the obvious apps are missing. Saying it first is better
 * than being caught by it, and it is also the argument: the reason a network is
 * needed is precisely that these companies will not open a door.
 */
export function SourcesCaveat() {
  return (
    <div className="mt-12 grid gap-6 border-t border-line pt-6 text-[14.5px] leading-relaxed text-dim lg:grid-cols-2">
      <p>
        <span className="text-ink">Why no food delivery or shopping logos.</span> There is no consumer OAuth for
        order history at DoorDash, Uber Eats, Deliveroo, Zomato or Amazon — every API in those spaces is
        merchant-side. Instagram switched off its personal API in December 2024; TripIt closed to new integrations
        in February 2026; LinkedIn&rsquo;s self-serve scopes return your name, not your history.
      </p>
      <p>
        That closure is the reason this exists. A person cannot move what they know between the products that know
        it, so the memory has to live somewhere neither of them owns.
      </p>
    </div>
  )
}
