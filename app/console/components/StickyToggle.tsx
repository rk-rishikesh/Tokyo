'use client'

import { Toggle } from './Toggle'
import { useMode } from './ModeContext'
import { TOGGLE_HINT } from '@/content/copy'

/** The vocabulary switch, pinned under the nav on every route. */
export function StickyToggle() {
  const { mode, setMode } = useMode()
  return (
    <div className="sticky top-0 z-20 border-y border-line bg-bg/85 py-3 backdrop-blur">
      <Toggle mode={mode} onChange={setMode} hint={TOGGLE_HINT[mode]} />
    </div>
  )
}
