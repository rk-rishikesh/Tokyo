/**
 * Chat, docked at the bottom of the canvas.
 *
 * The reference ends its workspace with a prompt bar — "describe your workflow"
 * — and the equivalent here is asking your own memory. It sits in its own strip
 * under the canvas rather than floating over it: floating, the canvas showed
 * through behind it.
 */
import { Chat } from './Chat'

export function PromptBar({ namespace }: { namespace: string }) {
  return (
    <div className="shrink-0 border-t border-line bg-bg px-4 py-4">
      <div className="mx-auto w-full max-w-[860px]">
        <Chat namespace={namespace} />
      </div>
    </div>
  )
}
