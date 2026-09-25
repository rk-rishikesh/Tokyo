import type { WorkspaceDef } from '@k01/connect/workspaces'
import { Monogram } from '@/components/Monogram'
import { localSources } from '@k01/connect/workspaces'
import { Onboarding } from './Onboarding'

/**
 * What someone sees before anything of theirs exists.
 *
 * The first step is a wallet, not an account. The ENS name it proves becomes
 * the namespace every claim is written to — there is no host-issued subdomain
 * to start on and upgrade from later, because a name this site handed out is
 * one this site could take back, and the argument the whole product rests on is
 * that what is written here survives us.
 *
 * The scopes are shown before the button rather than after. A consent screen
 * that arrives once someone has already committed is the pattern this is
 * arguing against.
 */
export function SignIn({ sources }: { providers: string[]; sources: WorkspaceDef[] }) {
  return (
    <main className="w-full px-5 pb-20 pt-14 sm:px-8 sm:pt-20 lg:px-10">
      <p className="text-[14px] leading-tight text-ink">Your memory.<br />Owned by you.</p>
      <div className="mt-6 grid gap-12 lg:grid-cols-2">
        <div>
          <h1 className="font-display text-[clamp(2.8rem,6vw,5.6rem)] font-normal leading-[0.94] tracking-[-0.045em]">Start with a name you own.</h1>
          <p className="mt-8 max-w-xl font-display text-[clamp(1.2rem,1.9vw,1.75rem)] leading-[1.18] tracking-[-0.03em] text-dim">
            Connect your wallet and pick one of your ENS names — or register one here, in three steps. Everything the
            agent learns is written under it, and stays readable if this site disappears tomorrow.
          </p>
        </div>
        <div className="lg:pt-2"><Onboarding /></div>
      </div>

      <section className="mt-24 border-t border-line pt-10">
        <div className="mb-10 grid gap-6 lg:grid-cols-2">
          <h2 className="font-display text-[clamp(1.8rem,3.2vw,2.9rem)] font-normal leading-[0.98] tracking-[-0.045em]">Then choose what it may read.</h2>
          <p className="max-w-xl text-[15px] leading-relaxed text-dim">
            Each source asks for the narrowest read that answers one question, and says what it will never do — before
            you connect it, not after.
          </p>
        </div>
        <div className="grid border-t border-line md:grid-cols-2 xl:grid-cols-3">
          {sources.map((ws) => (
            <div key={ws.id} className="border-b border-line py-7 md:pr-10">
              <div className="flex items-center gap-3">
                <Monogram name={ws.name} />
                <p className="text-[clamp(1.15rem,1.6vw,1.45rem)] leading-tight tracking-[-0.03em]">{ws.name}</p>
              </div>
              <p className="mt-4 text-[14px] leading-snug text-ink/80">{ws.summary}</p>
              {ws.scopes.map((sc) => (
                <p key={sc.id} className="mt-2 text-[14px] leading-relaxed text-dim">
                  <span className="text-ink">{sc.label}.</span> {sc.detail}
                </p>
              ))}
              <p className="mt-3 text-[13.5px] leading-relaxed text-dim/80">
                <span className="text-ink/60">Never —</span> {ws.never.join(' · ')}
              </p>
            </div>
          ))}
        </div>
      </section>

      <p className="mt-10 max-w-2xl text-[14px] leading-relaxed text-dim">
        Running this on your own machine reads more: {localSources().map((w) => w.name.toLowerCase()).join(', ')} are
        files rather than accounts, so there is nothing to sign into — and a website cannot read them.
      </p>
    </main>
  )
}
