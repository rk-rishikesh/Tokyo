/**
 * What ENSv2 provides that makes this possible.
 *
 * This had become invisible on the landing page, which is a problem, because
 * without it the product reads as "a memory app with a wallet button". The
 * features below are not decoration: each one is load-bearing, and each is
 * something the alternative — a database with a user id — cannot do at all.
 *
 * Every row names the specific ENSv2 mechanism rather than gesturing at "web3",
 * and the roles are the real nybble-packed ones from EnhancedAccessControl that
 * the code already reads and writes.
 */

const FEATURES: { title: string; ens: string; body: string; without: string }[] = [
  {
    title: 'The name is the identity',
    ens: 'ENS registry',
    body: 'A namespace is a name you own on chain — confirmable by anyone, revocable by no one else.',
    without: 'a user id in someone else’s database',
  },
  {
    title: 'Namespaces nest',
    ens: 'Subregistries',
    body: 'food.yours.eth has its own owner and policy, so one branch can be handed over without the rest.',
    without: 'a path string in a table',
  },
  {
    title: 'Permissions live on chain',
    ens: 'EnhancedAccessControl',
    body: 'Who may publish or propose is a role granted by transaction — anyone can verify it.',
    without: 'an is_admin column',
  },
  {
    title: 'Versions are pointed at',
    ens: 'contenthash',
    body: 'The name points at the current version on IPFS; history stays addressable, no server in the way.',
    without: 'an API that has to stay up',
  },
  {
    title: 'Anyone can resolve it',
    ens: 'Universal Resolver',
    body: 'An agent that has never heard of us can read the claims. That makes it a network, not a product.',
    without: 'an integration per app',
  },
  {
    title: 'Ownership can move',
    ens: 'Registry transfer',
    body: 'Transfer the name and the memory goes with it — nothing to migrate, nobody to ask.',
    without: 'a support ticket',
  },
]

export function WhyEns() {
  return (
    <div className="grid border-t border-line md:grid-cols-2 lg:grid-cols-3">
      {FEATURES.map((f, i) => (
        <div key={f.title} className="kn-rise border-b border-line py-6 md:pr-10" style={{ animationDelay: `${i * 0.05}s` }}>
          <div className="flex items-baseline justify-between gap-4">
            <span className="font-mono text-[12.5px] text-dim">{String(i + 1).padStart(2, '0')}</span>
            <span className="text-[12.5px] text-dim">{f.ens}</span>
          </div>
          <h3 className="mt-4 font-display text-[clamp(1.4rem,2.2vw,2rem)] font-normal leading-[1.02] tracking-[-0.025em]">{f.title}.</h3>
          <p className="mt-2.5 max-w-[42ch] text-[14px] leading-relaxed text-dim">{f.body}</p>
          <p className="mt-3 text-[12.5px] text-dim/70">Instead of {f.without}.</p>
        </div>
      ))}
    </div>
  )
}
