import type { Config } from 'tailwindcss'

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './content/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // canonical
        bg: 'hsl(var(--bg))',
        surface: 'hsl(var(--surface))',
        raised: 'hsl(var(--raised))',
        line: 'hsl(var(--line))',
        ink: 'hsl(var(--ink))',
        dim: 'hsl(var(--dim))',
        accent: 'hsl(var(--accent))',
        'accent-soft': 'hsl(var(--accent-soft))',

        // aliases used by the app routes
        border: 'hsl(var(--border))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: 'hsl(var(--card))',
        muted: 'hsl(var(--muted))',
        'muted-foreground': 'hsl(var(--muted-foreground))',

        added: 'hsl(var(--added))',
        'added-bg': 'hsl(var(--added-bg))',
        removed: 'hsl(var(--removed))',
        'removed-bg': 'hsl(var(--removed-bg))',
        warn: 'hsl(var(--warn))',
        'warn-bg': 'hsl(var(--warn-bg))',

        owner: 'hsl(var(--owner))',
        member: 'hsl(var(--member))',
        propose: 'hsl(var(--propose))',

        canvas: 'hsl(var(--canvas))',
        dot: 'hsl(var(--dot))',
        chip: 'hsl(var(--chip))',
        'active-ring': 'hsl(var(--active-ring))',
        'active-badge': 'hsl(var(--active-badge))',
        wire: 'hsl(var(--wire))',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'ui-serif', 'Georgia', 'serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config
