/**
 * A source's mark, in the product's monochrome: the first letters of its name
 * in a rounded tile. Emoji brought colour — and a different drawing of every
 * logo on every platform — into pages that are otherwise black and white.
 */
export function Monogram({ name, size = 'md', tone = 'ink' }: { name: string; size?: 'sm' | 'md' | 'lg'; tone?: 'ink' | 'soft' }) {
  // Two letters that tell sources apart: the capitals of a CamelCase name
  // (GitHub → GH), the initials of two words (Google Takeout → GT), otherwise
  // the first two letters (Granola → Gr, Linear → Li).
  const words = name.replace(/^your\s+/i, '').split(/[\s·/-]+/).filter(Boolean)
  const caps = (words[0] ?? '').match(/[A-Z]/g) ?? []
  const letters = words.length > 1
    ? words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')
    : caps.length > 1 ? caps.slice(0, 2).join('') : (words[0] ?? '').slice(0, 2).replace(/^./, (c) => c.toUpperCase())
  const box = { sm: 'h-7 w-7 rounded-lg text-[12.5px]', md: 'h-9 w-9 rounded-xl text-[14px]', lg: 'h-11 w-11 rounded-2xl text-[14px]' }[size]
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center font-medium tracking-[-0.02em] ${box} ${tone === 'ink' ? 'bg-ink text-bg' : 'bg-raised text-ink/70'}`}
    >
      {letters || '·'}
    </span>
  )
}
