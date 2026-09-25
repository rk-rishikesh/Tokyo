import { CallToAction, Footer, Question } from '@/components/landing/Sections'
import { AccessFirsts } from '@/components/landing/AccessFirsts'
import { Hero } from '@/components/landing/Hero'
import { WhyEns } from '@/components/landing/WhyEns'
import { Label, Lead, Pill, Section, Split, Statement, Title, Wordmark } from '@/components/mono'
import { FlowGraph, LOOP_EDGES, LOOP_NODES } from '@/components/motion/FlowGraph'
import { ThesisMotion } from '@/components/motion/Thesis'

/**
 * The landing page, in the reference's grammar: full width, a hairline over
 * each section, a small label against a large paragraph, a wordmark set huge,
 * grey media, and numbers with their units in brackets. The hero is its own
 * thing and is left exactly as it was.
 *
 * Media are placeholders until there is real footage. The diagrams are not:
 * both are Remotion compositions of what the product actually does.
 */
export default function Page() {
  return (
    <>
      <Hero />

      {/* Introducing ---------------------------------------------------- */}
      <Section>
        <Split label={<>Introducing<br />knowledge.eth.</>} action={<Pill href="#how">See how it works</Pill>}>
          <Lead>
            A knowledge network gives what one agent learns about you a home under an ENS name you own — versioned,
            sourced, encrypted, and readable by any agent you choose, long after the one that learned it is gone.
          </Lead>
        </Split>
      </Section>

      {/* The wordmark ---------------------------------------------------- */}
      <Section rule={false} className="-mt-10">
        <Wordmark text="K.01" />
        <div className="mt-8 grid gap-8 border-t border-line pt-5 lg:grid-cols-2">
          <p className="max-w-[34ch] text-[13.5px] leading-snug text-dim">
            Built on ENSv2 — registries, resolvers and roles that already exist on Sepolia. No custom contract sits on
            the write path.
          </p>
          <div className="lg:border-l lg:border-line lg:pl-8">
            <Pill href="/protocol" size="sm">Meet the protocol</Pill>
          </div>
        </div>
      </Section>

      {/* The thesis, in motion ------------------------------------------ */}
      <Section id="how" className="scroll-mt-16">
        <div className="mb-10 grid gap-8 lg:grid-cols-2">
          <Title size="lg">One agent learns. Another reads.</Title>
          <Lead tone="dim">
            The memory is not inside either of them. It is under your name, so switching agents — or losing one —
            changes who reads it, not whether it exists.
          </Lead>
        </div>
        <ThesisMotion />
      </Section>

      {/* Statement + media ---------------------------------------------- */}
      <Section>
        <Statement
          title={<>We&rsquo;re building memory that outlives the app.</>}
          action={<Pill href="/app">Build your knowledge</Pill>}
        >
          Every memory product today is a store inside one application. What it learns dies with it, and the next
          product starts from nothing. Here, the claims live under a name you own; an app is only ever a reader you
          allowed, or a writer whose proposals you review.
        </Statement>
      </Section>

      {/* The loop ------------------------------------------------------- */}
      <Section>
        <Split label={<>The loop.<br />Six steps, every claim.</>}>
          <Lead tone="dim">
            Nothing is overwritten and nothing is anonymous. A claim carries its source and confidence, passes
            automated findings and your review, is sealed with its namespace&rsquo;s key, and reaches your name when
            you sign.
          </Lead>
        </Split>
        <div className="mt-12">
          <FlowGraph nodes={LOOP_NODES} edges={LOOP_EDGES} label="Observation, then a proposal and automated findings, then your review and sealing, then your ENS name." />
        </div>
      </Section>

      {/* Introducing the access record ----------------------------------- */}
      <Section>
        <Split label={<>Introducing<br />knowledge.access.</>}>
          <Lead tone="dim">
            One text record on your name lists who may read each namespace — public keys, and the namespace key sealed
            to each of them. Any agent can check it. Only the ones on it can use it. It is a series of firsts:
          </Lead>
        </Split>
        <AccessFirsts />
      </Section>

      {/* Why ENSv2 ------------------------------------------------------- */}
      <Section>
        <div className="mb-14 grid gap-8 lg:grid-cols-2">
          <Title size="md">Six things a user id cannot do.</Title>
          <Lead tone="dim">
            None of this is decoration. Each is a mechanism the code reads and writes, and each is the reason a claim
            here is not another row in somebody&rsquo;s product.
          </Lead>
        </div>
        <WhyEns />
      </Section>

      {/* Questions ------------------------------------------------------- */}
      <Section>
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <Label>Questions.</Label>
            <Title size="md" className="mt-4">What people actually ask.</Title>
          </div>
          <div>
            <Question q="Is this reading my messages?" open>
              No. Each source asks for the narrowest access that answers one question and says what it will never do.
              Gmail is sender domains, never a body. Granola is who you met, never a transcript. GitHub is repository
              metadata, never your code.
            </Question>
            <Question q="What happens if this site disappears?">
              Your name is on ENS and the versions are on IPFS, sealed to a key your wallet can re-derive. Any agent you
              granted keeps reading, and so can you.
            </Question>
            <Question q="Who can read my namespace?">
              Whoever holds a sealed key in its access record. The honest caveat: the app still generates each
              namespace&rsquo;s key, so today the operator could read it. Generating keys in the browser is next.
            </Question>
            <Question q="Can an agent write to my memory?">
              It can propose. What lands is decided by the namespace policy — approvals, reviewers, conflicts.
              Contributing and committing are deliberately different things.
            </Question>
          </div>
        </div>
      </Section>

      {/* Close ----------------------------------------------------------- */}
      <Section>
        <CallToAction
          title={<>Your agents change. Your knowledge doesn&rsquo;t.</>}
          body="Connect a name you own and one app you already use. The first claim lands in under a minute."
        />
      </Section>

      <Footer />
    </>
  )
}
