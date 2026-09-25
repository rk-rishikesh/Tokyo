'use client'

import type { Mode } from '@/content/copy'

/**
 * The page's central control.
 *
 * Prominent and sticky because switching it *is* the argument: the same
 * structure holds whether you describe it in ENS primitives or in plain words.
 */
export function Toggle({
  mode,
  onChange,
  hint,
}: {
  mode: Mode
  onChange: (m: Mode) => void
  hint: string
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        role="radiogroup"
        aria-label="Explanation vocabulary"
        className="inline-flex rounded-full border border-line bg-surface p-1 shadow-sm"
      >
        {(
          [
            ['ens', 'ENS terms'],
            ['plain', 'Plain English'],
          ] as const
        ).map(([value, label]) => {
          const active = mode === value
          return (
            <button
              key={value}
              role="radio"
              aria-checked={active}
              onClick={() => onChange(value)}
              className={`rounded-full px-4 py-1.5 text-[15px] font-medium transition-colors ${
                active
                  ? 'bg-ink text-bg'
                  : 'text-dim hover:text-ink'
              }`}
            >
              {label}
            </button>
          )
        })}
      </div>
      <p key={hint} className="relabel text-[13.5px] text-dim">
        {hint}
      </p>
    </div>
  )
}
