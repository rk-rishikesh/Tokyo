import type { ReactNode } from 'react'

const p = {
  width: 14,
  height: 14,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export type IconName = 'init' | 'remember' | 'branch' | 'merge' | 'push' | 'pull' | 'search' | 'why' | 'revert'

export const Icons: Record<IconName, ReactNode> = {
  init: (
    <svg {...p}><path d="M12 3 3 8l9 5 9-5-9-5Z" /><path d="M3 12l9 5 9-5" /><path d="M3 16l9 5 9-5" /></svg>
  ),
  remember: (
    <svg {...p}><circle cx="12" cy="12" r="3" /><path d="M12 3v6M12 15v6" /></svg>
  ),
  branch: (
    <svg {...p}><circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="8" r="2" /><path d="M6 7v10" /><path d="M18 10c0 4-4 5-8 6" /></svg>
  ),
  merge: (
    <svg {...p}><circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="12" r="2" /><path d="M6 7v10" /><path d="M6 7c0 5 6 5 10 5" /></svg>
  ),
  push: (
    <svg {...p}><path d="M12 19V7" /><path d="m6 13 6-6 6 6" /><path d="M4 21h16" /></svg>
  ),
  pull: (
    <svg {...p}><path d="M12 5v12" /><path d="m18 11-6 6-6-6" /><path d="M4 21h16" /></svg>
  ),
  search: (
    <svg {...p}><circle cx="11" cy="11" r="6" /><path d="m20 20-4-4" /></svg>
  ),
  why: (
    <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7" /><path d="M12 17h.01" /></svg>
  ),
  revert: (
    <svg {...p}><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></svg>
  ),
}
