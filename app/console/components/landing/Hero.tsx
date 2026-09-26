import Image from 'next/image'
import Link from 'next/link'

/**
 * The hero.
 *
 * Oversized type set hard against the left edge, the graphic bleeding off the
 * right, and the supporting line held down at the bottom of the fold — the
 * reference's proportions. The headline carries the argument on its own, so
 * the paragraph can stay small and specific rather than restating it.
 *
 * The image is decorative. It is marked so for assistive technology, and the
 * page reads correctly without it.
 */
export function Hero() {
  return (
    <section className="kn-hero relative min-h-[88vh] overflow-hidden px-6 pb-14 pt-10 sm:px-10">
      {/* The graphic, bleeding off the right edge. */}
      <div className="pointer-events-none absolute right-0 top-0 h-full w-[62%] max-w-[900px] select-none" aria-hidden>
        <Image
          src="/images/hero.png"
          alt=""
          fill
          priority
          sizes="(max-width: 1024px) 70vw, 900px"
          className="object-contain object-right-top opacity-95 dark:opacity-80"
        />
      </div>

      {/* Thin arcs, as in the reference — drawn rather than shipped as an image. */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice">
        <path d="M 340 -60 C 560 180, 620 420, 500 470" className="stroke-[hsl(var(--line))]" strokeWidth={1} fill="none" />
        <path d="M 980 -40 C 1010 220, 900 520, 620 700" className="stroke-[hsl(var(--line))]" strokeWidth={1} fill="none" />
        <line x1="1000" y1="0" x2="1000" y2="620" className="stroke-[hsl(var(--line))]" strokeWidth={1} />
      </svg>

      <div className="relative flex min-h-[78vh] flex-col justify-between">
        <h1 className="kn-rise max-w-[16ch] font-display text-[clamp(3rem,9.5vw,8rem)] font-normal lowercase leading-[0.86] tracking-[-0.03em]">
          your agents
          <br />
          change.
          <br />
          <span className="relative">
            your knowledge doesn&apos;t.
            <span className="absolute -right-8 top-2 text-[0.2em] align-super text-dim" aria-hidden>◈</span>
          </span>
        </h1>

        <div className="kn-rise mt-16 max-w-2xl" style={{ animationDelay: '0.12s' }}>
          <p className="text-[13.5px] leading-relaxed text-dim">
            What one agent learns about you becomes versioned, source-backed claims under an ENS name you own —
            encrypted, and sealed only to the agents you choose. Switch agents, delete one, and the next reads the
            same memory from the network rather than starting from nothing.
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-5">
            <Link
              href="/app"
              className="group inline-flex items-center gap-3 rounded-full bg-ink py-2 pl-2 pr-6 text-sm font-medium text-bg transition-opacity hover:opacity-90"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-bg/15 text-[15px] transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden>
                ↗
              </span>
              Build your knowledge
            </Link>
            <Link href="#how" className="text-sm text-dim underline-offset-4 transition-colors hover:text-ink hover:underline">
              See how it works
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
