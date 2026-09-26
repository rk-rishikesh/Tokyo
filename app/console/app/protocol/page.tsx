'use client'

import Link from 'next/link'
import { Tree } from '@/components/Tree'
import { FlowCanvas } from '@/components/FlowCanvas'
import { Examples } from '@/components/Examples'
import { HERO, POSITIONING, type Mode } from '@/content/copy'
import { Footer } from '@/components/Guide'
import { FlowGraph, LOOP_EDGES, LOOP_NODES } from '@/components/motion/FlowGraph'

// One vocabulary: this page is where the ENS terms are the point. The toggle
// between them and plain English was removed — it changed little.
const mode: Mode = 'ens'

export default function Protocol() {
  const hero = HERO[mode]
  const positioning = POSITIONING[mode]

  return (
    <div className="w-full px-5 sm:px-8 lg:px-10">
      <section className="pb-14 pt-14 sm:pt-20">
        <p key={`k-${mode}`} className="relabel text-[14px] leading-tight text-ink">Protocol.<br />{hero.kicker}</p>
        <div className="mt-6 grid gap-10 lg:grid-cols-2">
          <h1 key={`t-${mode}`} className="relabel text-balance font-display text-[clamp(2.8rem,6.4vw,6rem)] font-normal leading-[0.94] tracking-[-0.025em]">{hero.title}</h1>
          <p key={`s-${mode}`} className="relabel text-pretty font-sans font-light text-[clamp(1.2rem,2vw,1.85rem)] leading-[1.3] tracking-[-0.015em] text-dim">{hero.sub}</p>
        </div>
      </section>

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
            <h2 key={`pt-${mode}`} className="relabel font-display text-[clamp(1.4rem,2.2vw,2rem)] font-normal leading-tight tracking-[-0.025em]">{positioning.title}</h2>
            <p key={`pb-${mode}`} className="relabel mt-4 text-[14.5px] leading-relaxed text-dim">{positioning.body}</p>
            <p key={`pa-${mode}`} className="relabel mt-4 border-l border-line pl-4 text-[14.5px] leading-relaxed text-dim">{positioning.aside}</p>
          </div>
          <div className="rounded-[28px] bg-ink p-8 text-bg">
            <h2 className="font-display text-[clamp(1.4rem,2.2vw,2rem)] font-normal leading-tight tracking-[-0.025em]">Memories are data, not instructions.</h2>
            <p className="mt-4 text-[14.5px] leading-relaxed text-bg/70">Every memory handed to a model arrives fenced, labelled as retrieved data, and stamped with its source, confidence and commit. A memory that says <em>“ignore your previous instructions”</em> is reported, not obeyed. This is not a setting; it is how results are shaped before the model sees them.</p>
          </div>
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
        <h2 className="font-display text-[clamp(1.8rem,3.2vw,2.9rem)] font-normal leading-[0.98] tracking-[-0.025em]">{title}</h2>
        <p className="max-w-2xl text-[15px] leading-relaxed text-dim">{intro}</p>
      </div>
      {children}
    </section>
  )
}
