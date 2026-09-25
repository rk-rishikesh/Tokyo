'use client'

import Link from 'next/link'
import { Tree } from '@/components/Tree'
import { FlowCanvas } from '@/components/FlowCanvas'
import { Examples } from '@/components/Examples'
import { StickyToggle } from '@/components/StickyToggle'
import { useMode } from '@/components/ModeContext'
import { HERO, POSITIONING } from '@/content/copy'
import { TEASER } from '@/content/compare'
import { Footer } from '@/components/Guide'
import { FlowGraph, LOOP_EDGES, LOOP_NODES } from '@/components/motion/FlowGraph'
import { Arrow } from '@/components/Arrow'

export default function Protocol() {
  const { mode } = useMode()
  const hero = HERO[mode]
  const teaser = TEASER[mode]
  const positioning = POSITIONING[mode]

  return (
    <div className="w-full px-5 sm:px-8 lg:px-10">
      <section className="pb-14 pt-14 sm:pt-20">
        <p key={`k-${mode}`} className="relabel text-[14px] leading-tight text-ink">Protocol.<br />{hero.kicker}</p>
        <div className="mt-6 grid gap-10 lg:grid-cols-2">
          <h1 key={`t-${mode}`} className="relabel text-balance font-display text-[clamp(2.8rem,6.4vw,6rem)] font-normal leading-[0.94] tracking-[-0.045em]">{hero.title}</h1>
          <p key={`s-${mode}`} className="relabel text-pretty font-display text-[clamp(1.3rem,2.2vw,2.1rem)] leading-[1.14] tracking-[-0.035em] text-dim">{hero.sub}</p>
        </div>
      </section>

      <StickyToggle />

      <main>
        <Block title="The loop." intro="Every claim passes the same six steps, whichever agent wrote it.">
          <FlowGraph nodes={LOOP_NODES} edges={LOOP_EDGES} label="Observation, proposal, findings, review, sealing, and your ENS name." />
        </Block>

        <Block title="The workflow." intro="Six moments, from creating a namespace to another agent pulling it. The wires are real dependencies. Pick a node to see its steps.">
          <FlowCanvas mode={mode} />
        </Block>

        <Block title="In practice." intro="The same repository, from a terminal, from inside an agent, and from a browser.">
          <Examples />
        </Block>

        <Block title="Where it lives." intro="Nothing below changes when you flip the switch — not the boxes, not what connects to what. Only the words.">
          <Tree mode={mode} />
        </Block>

        <section className="grid gap-4 border-t border-line py-16 lg:grid-cols-2">
          <div className="rounded-[28px] bg-raised p-8">
            <h2 key={`pt-${mode}`} className="relabel font-display text-[clamp(1.4rem,2.2vw,2rem)] font-normal leading-tight tracking-[-0.04em]">{positioning.title}</h2>
            <p key={`pb-${mode}`} className="relabel mt-4 text-[14.5px] leading-relaxed text-dim">{positioning.body}</p>
            <p key={`pa-${mode}`} className="relabel mt-4 border-l border-line pl-4 text-[14.5px] leading-relaxed text-dim">{positioning.aside}</p>
          </div>
          <div className="rounded-[28px] bg-ink p-8 text-bg">
            <h2 className="font-display text-[clamp(1.4rem,2.2vw,2rem)] font-normal leading-tight tracking-[-0.04em]">Memories are data, not instructions.</h2>
            <p className="mt-4 text-[14.5px] leading-relaxed text-bg/70">Every memory handed to a model arrives fenced, labelled as retrieved data, and stamped with its source, confidence and commit. A memory that says <em>“ignore your previous instructions”</em> is reported, not obeyed. This is not a setting; it is how results are shaped before the model sees them.</p>
          </div>
        </section>

        <section className="border-t border-line py-16">
          <Link href="/compare" className="group grid gap-6 lg:grid-cols-2">
            <h2 key={`ct-${mode}`} className="relabel font-display text-[clamp(1.8rem,3.2vw,2.9rem)] font-normal leading-[0.98] tracking-[-0.045em]">{teaser.title}</h2>
            <div>
              <p key={`cb-${mode}`} className="relabel text-[15px] leading-relaxed text-dim">{teaser.body}</p>
              <span className="mt-6 inline-flex items-center gap-3 rounded-full bg-ink px-6 py-3.5 text-[15px] text-bg transition group-hover:opacity-85">The full comparison <Arrow /></span>
            </div>
          </Link>
        </section>
      </main>
      <Footer />
    </div>
  )
}

function Block({ title, intro, children }: { title: string; intro: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line py-16 sm:py-20">
      <div className="mb-10 grid gap-6 lg:grid-cols-2">
        <h2 className="font-display text-[clamp(1.8rem,3.2vw,2.9rem)] font-normal leading-[0.98] tracking-[-0.045em]">{title}</h2>
        <p className="max-w-2xl text-[15px] leading-relaxed text-dim">{intro}</p>
      </div>
      {children}
    </section>
  )
}
