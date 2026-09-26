'use client'

import Image from 'next/image'
import { useState } from 'react'

const FIRSTS = [
  { title: 'Scoped by key, not by interface', body: 'Granting food.you.eth says nothing about work.you.eth. The keys are per namespace, so a denied namespace is ciphertext to the agent — not a hidden tab.', image: '/images/one.png' },
  { title: 'Revocation that means something', body: 'Dropping a sealed key is not enough; the old key still opens old bytes. So a revoke re-keys every version and re-seals for whoever remains.', image: '/images/two.png' },
  { title: 'Recoverable with your wallet', body: 'Every namespace carries a key sealed to one only your wallet can re-derive. Delete the app, sign one message, read it all back.', image: '/images/three.png' },
  { title: 'Published by you, not by us', body: 'Grants are staged, then written to your name by your own transaction. The app prepares calldata; it never holds a key that could send it.', image: '/images/four.png' },
]

/**
 * The access record's firsts, one open at a time, with the picture for the
 * open one beside them.
 */
export function AccessFirsts() {
  const [active, setActive] = useState(0)

  return (
    <div className="mt-14 grid gap-10 lg:grid-cols-2">
      <div className="divide-y divide-line border-t border-line">
        {FIRSTS.map((it, i) => {
          const open = i === active
          return (
            <div key={it.title} className="py-5">
              <button
                type="button"
                onClick={() => setActive(i)}
                aria-expanded={open}
                className="flex w-full items-center gap-3 text-left text-[16px] tracking-[-0.015em]"
              >
                <span className="h-2 w-2 rounded-full bg-ink" aria-hidden />
                {it.title}
                <span className={`ml-auto h-px w-4 bg-ink transition-opacity ${open ? 'opacity-100' : 'opacity-40'}`} aria-hidden />
              </button>
              {open ? <p className="mt-3 max-w-md pl-5 text-[14.5px] leading-relaxed text-dim">{it.body}</p> : null}
            </div>
          )
        })}
      </div>
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[28px] bg-ink/5">
        {FIRSTS.map((it, i) => (
          <Image
            key={it.image}
            src={it.image}
            alt={it.title}
            fill
            sizes="(min-width: 1024px) 50vw, 100vw"
            className={`object-cover transition-opacity duration-500 ${i === active ? 'opacity-100' : 'opacity-0'}`}
            aria-hidden={i !== active}
          />
        ))}
      </div>
    </div>
  )
}
