/**
 * What a personal agent is made of.
 *
 * The apps someone already uses, each contributing the one thing it actually
 * knows, into a namespace they own.
 *
 * Every app named here has a real OAuth or MCP surface — four are connected in
 * this product today and the rest were verified against vendor documentation.
 * An earlier version used category labels (Food, Shopping, Travel) which read
 * as placeholders, and naming DoorDash or Amazon instead would have been worse:
 * neither offers any way for a person to read their own order history.
 *
 * Google Takeout is how food and shopping actually arrive. Its Data Portability
 * API is OAuth-based and covers order and reservation activity, which is the
 * only sanctioned route to that data that exists.
 */

type Card = {
  glyph: string
  app: string
  claim: string
  namespace: string
  tint: string
}

const CARDS: Card[] = [
  { glyph: '🐙', app: 'GitHub', claim: 'Works on loops-platform, writes TypeScript', namespace: 'projects.yours.eth', tint: 'from-[hsl(258_70%_62%/0.16)]' },
  { glyph: '🌀', app: 'Granola', claim: 'Meets Sarah at Germina most weeks', namespace: 'projects.yours.eth', tint: 'from-[hsl(200_85%_58%/0.16)]' },
  { glyph: '🏃', app: 'Strava', claim: 'Runs before work, never after', namespace: 'interests.yours.eth', tint: 'from-[hsl(18_90%_62%/0.16)]' },
  { glyph: '🎧', app: 'Spotify', claim: 'Listens while writing, not while reading', namespace: 'interests.yours.eth', tint: 'from-[hsl(150_60%_45%/0.16)]' },
  { glyph: '📦', app: 'Google Takeout', claim: 'Orders vegetarian, never after 9pm', namespace: 'food.yours.eth', tint: 'from-[hsl(45_90%_55%/0.16)]' },
  { glyph: '⌨️', app: 'Your editor', claim: 'Uses pnpm, never npm', namespace: 'conventions.yours.eth', tint: 'from-[hsl(330_80%_62%/0.16)]' },
]

export function PersonalAgent() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {CARDS.map((c, i) => (
        <div
          key={c.app}
          className={`kn-rise rounded-3xl border border-line bg-gradient-to-br ${c.tint} to-transparent p-5`}
          style={{ animationDelay: `${i * 0.06}s` }}
        >
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-surface text-[17px]" aria-hidden>
              {c.glyph}
            </span>
            <p className="text-[14px] font-medium">{c.app}</p>
          </div>
          <p className="mt-3.5 text-[14.5px] leading-snug">{c.claim}</p>
          <p className="mt-2.5 font-mono text-[12.5px] text-dim">→ {c.namespace}</p>
        </div>
      ))}
    </div>
  )
}

/**
 * The same claims, seen from the other side: one agent reading all of them.
 *
 * The point of the network is that a new app reads what the old ones learned
 * without either of them integrating. So this is deliberately an app nobody has
 * connected — the memory was not written for it and it works anyway.
 */
export function AgentReads() {
  // Claims the readers in this product genuinely produce, from sources that
  // genuinely connect. An earlier version showed dietary and travel
  // preferences, which read well and described integrations nobody can build.
  const lines = [
    { from: 'interests.yours.eth', text: 'Orders from Dishoom regularly' },
    { from: 'tools.yours.eth', text: 'Writes TypeScript' },
    { from: 'projects.yours.eth', text: 'Works with Sarah at Celo' },
  ]
  return (
    <div className="rounded-3xl border border-line bg-surface p-5 shadow-[0_2px_4px_rgba(0,0,0,0.03),0_18px_44px_-24px_rgba(0,0,0,0.2)]">
      <div className="flex items-center gap-2.5 border-b border-line pb-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-ink text-[15px] text-bg" aria-hidden>✦</span>
        <div className="min-w-0">
          <p className="text-[14.5px] font-medium">An app you opened for the first time today</p>
          <p className="text-[12.5px] text-dim">never connected · knows nothing about you</p>
        </div>
      </div>

      <p className="mt-3.5 font-mono text-[12.5px] text-dim">knowledge_search(&ldquo;yours.eth&rdquo;)</p>

      <div className="mt-2.5 space-y-2">
        {lines.map((l, i) => (
          <div key={l.from} className="kn-rise rounded-xl border border-line bg-raised/50 px-3 py-2" style={{ animationDelay: `${0.2 + i * 0.12}s` }}>
            <p className="text-[14.5px] leading-snug">{l.text}</p>
            <p className="mt-0.5 font-mono text-[12px] text-dim">{l.from}</p>
          </div>
        ))}
      </div>

      <p className="mt-3.5 text-[13.5px] leading-relaxed text-dim">
        It did not need an integration, and you did not fill in a profile. It resolved a name and read claims that
        were already there — with the source of each one still attached.
      </p>
    </div>
  )
}
