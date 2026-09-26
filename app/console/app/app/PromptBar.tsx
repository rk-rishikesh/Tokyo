'use client'

/**
 * The pipeline and the chat under it, as one column.
 *
 * Before a question, the pipeline is the subject and chat is a bar at the
 * bottom. Once a conversation starts, the pipeline steps aside and the chat
 * takes the height: reading the answer is the task then, and the strip above
 * only pushed it down. "New chat" brings the pipeline back.
 */
import { useState } from 'react'
import { Chat } from './Chat'

export function PromptBar({ namespace, canvas }: { namespace?: string | null; canvas: React.ReactNode }) {
  const [active, setActive] = useState(false)
  return (
    <>
      {active ? null : <div className="min-h-0 flex-1">{canvas}</div>}
      {namespace ? <Chat namespace={namespace} onActive={setActive} /> : null}
    </>
  )
}
