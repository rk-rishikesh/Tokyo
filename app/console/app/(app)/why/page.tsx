import { POLICY, WORKSPACES, CONFIDENCE, workspacesFor } from '@k01/connect'
import { readActivity } from '@k01/connect'
import { viewer } from '@/lib/session'
import { PageHeader } from '@/components/ui'
import { SectionHeading } from '@/components/ui'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Why something was not remembered' }

/**
 * The question the demo produces most, answered.
 *
 * "Why wasn't this remembered?" had no answer anywhere in the interface — the
 * bars a finding has to clear were literals in eight files, so the only way to
 * learn why something was ignored was to read the source. They are policy now,
 * which means they can be shown.
 *
 * This is also the honest half of the argument. An agent that keeps everything
 * is the failure mode; being able to say precisely what it discarded, and on
 * what rule, is what separates that from an agent that simply missed things.
 */
export default async function Why() {
  const v = await viewer()
  const userId = v.mode === 'hosted' ? v.user?.id : undefined
  const skipped = readActivity(200, userId).filter((a) => a.outcome.status === 'skipped')
  const byReason = new Map<string, number>()
  for (const s of skipped) {
    if (s.outcome.status !== 'skipped') continue
    byReason.set(s.outcome.reason, (byReason.get(s.outcome.reason) ?? 0) + 1)
  }

  const hosted = v.mode === 'hosted'
  const sources = workspacesFor({ hosted, ...(hosted ? { providers: v.providers } : {}) })

  return (
    <>
      <PageHeader
        title="Why something was not remembered"
        subtitle="Every bar a finding has to clear, and what was turned away."
      />

      <section className="mb-10">
        <SectionHeading title="What each source needs to see">
          A claim is not made from a single glance. These are the thresholds, and changing one is a configuration
          edit rather than a code change.
        </SectionHeading>
        <div className="overflow-x-auto rounded-2xl border border-line">
          <table className="w-full text-left text-[14.5px]">
            <thead className="bg-raised/60 text-[12.5px] uppercase tracking-wide text-dim">
              <tr>
                <th className="px-4 py-2.5 font-medium">Source</th>
                <th className="px-4 py-2.5 font-medium">Looks back</th>
                <th className="px-4 py-2.5 font-medium">Before it counts</th>
                <th className="px-4 py-2.5 font-medium">Keeps at most</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((ws) => {
                const p = (POLICY as Record<string, { windowDays: number; min: number; minLabel: string; keep: number }>)[ws.id]
                if (!p) return null
                return (
                  <tr key={ws.id} className="border-t border-line">
                    <td className="px-4 py-2.5"><span aria-hidden>{ws.glyph}</span> {ws.name}</td>
                    <td className="px-4 py-2.5 text-dim">{p.windowDays ? `${p.windowDays} days` : 'everything available'}</td>
                    <td className="px-4 py-2.5 text-dim">{p.min} {p.minLabel}</td>
                    <td className="px-4 py-2.5 text-dim">{p.keep}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-10">
        <SectionHeading title="How sure it is, and why">
          Confidence is not decoration. It says how much evidence a claim rests on, so two independent sources
          saying the same thing raises it and a single observation does not pretend to be a pattern.
        </SectionHeading>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Someone said it', CONFIDENCE.human, 'A person stated it themselves.'],
            ['A counted rule', CONFIDENCE.rules, 'A threshold cleared by real numbers — visits, commits, meetings.'],
            ['A model read it', CONFIDENCE.model, 'It sees what no table could, and is wrong more often.'],
            ['One observation', CONFIDENCE.sparse, 'True, and not yet a pattern.'],
          ].map(([label, value, why]) => (
            <div key={label as string} className="rounded-2xl border border-line bg-surface p-4">
              <p className="font-display text-3xl leading-none">{Math.round((value as number) * 100)}%</p>
              <p className="mt-1.5 text-[14.5px] font-medium">{label as string}</p>
              <p className="mt-1 text-[13.5px] leading-relaxed text-dim">{why as string}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <SectionHeading title="What it turned away">
          {skipped.length
            ? 'Things the agent saw and decided were not knowledge.'
            : 'Nothing has been turned away yet.'}
        </SectionHeading>
        {byReason.size ? (
          <div className="space-y-2">
            {[...byReason].sort((a, b) => b[1] - a[1]).map(([reason, n]) => (
              <div key={reason} className="flex items-center justify-between gap-4 rounded-2xl border border-line bg-surface px-4 py-3">
                <p className="text-[13.5px]">{reason}</p>
                <p className="shrink-0 text-[13.5px] text-dim">{n} time{n === 1 ? '' : 's'}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-line px-6 py-8 text-center text-[14.5px] text-dim">
            An agent that keeps everything is the failure mode. When this list fills up, that is the product working.
          </div>
        )}
      </section>
    </>
  )
}
