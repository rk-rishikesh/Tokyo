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
    body:
      'A namespace is a name someone owns on chain. Not a row we created for them, not an account they can be locked out of — a registration a registry will confirm to anyone who asks.',
    without: 'A user id in someone else’s database, revocable by whoever runs it.',
  },
  {
    title: 'Namespaces nest, and each child is its own',
    ens: 'Subregistries · setSubregistry · setParent',
    body:
      'food.yours.eth has its own registry, its own owner and its own policy. You can give a team control of one branch without giving them the rest, and a child can outlive its parent’s operator.',
    without: 'A path string in a table, with permissions enforced by application code.',
  },
  {
    title: 'Permissions live on chain, per role',
    ens: 'EnhancedAccessControl',
    body:
      'Registrar, renew, set-resolver, set-subregistry, set-parent, setContenthash — thirty-two role slots, each with its own admin half, granted and revoked by transaction. A reviewer’s authority is a fact anyone can verify, not a claim our server makes.',
    without: 'An `is_admin` column, and a promise that the code checks it.',
  },
  {
    title: 'Versions are pointed at, not stored',
    ens: 'contenthash on the resolver',
    body:
      'The name resolves to a contenthash for the current version on IPFS. History stays addressable, the pointer moves, and reading a namespace never touches our servers.',
    without: 'A URL to an API that has to stay up, run by whoever owns it.',
  },
  {
    title: 'Anyone can resolve it',
    ens: 'Universal Resolver',
    body:
      'An agent that has never heard of us can resolve a name and read the claims. That is what makes this a network rather than a product with an export button.',
    without: 'An integration, negotiated per company, per app.',
  },
  {
    title: 'Ownership can move',
    ens: 'Registry transfer',
    body:
      'Sell the name, hand it to an organisation, pass it on. The memory goes with it, because the memory *is* the name. Nothing to migrate and nobody to ask.',
    without: 'A support ticket, if the product offers one at all.',
  },
]

export function WhyEns() {
  return (
    <div className="grid border-t border-line md:grid-cols-2 lg:grid-cols-3">
      {FEATURES.map((f, i) => (
        <div key={f.title} className="kn-rise border-b border-line py-8 md:pr-10" style={{ animationDelay: `${i * 0.05}s` }}>
          <div className="flex items-baseline justify-between gap-4">
            <span className="font-mono text-[12.5px] text-dim">{String(i + 1).padStart(2, '0')}</span>
            <span className="text-[12.5px] text-dim">{f.ens}</span>
          </div>
          <h3 className="mt-6 font-display text-[clamp(1.4rem,2.2vw,2rem)] font-normal leading-[1.02] tracking-[-0.04em]">{f.title}.</h3>
          <p className="mt-3 text-[14px] leading-relaxed text-dim">{f.body}</p>
          <p className="mt-4 text-[14px] leading-relaxed text-dim/70">
            <span className="text-ink/60">Without it —</span> {f.without}
          </p>
        </div>
      ))}
    </div>
  )
}
