/**
 * The one arrow the interface uses for "go there": pointing up and to the
 * right, drawn rather than typed so it has the same weight and angle in every
 * font, and nudging along its own diagonal when its link is hovered.
 *
 * Put `group` on the link or button for the nudge.
 */
export function Arrow({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden
      className={`inline-block h-[0.82em] w-[0.82em] shrink-0 transition-transform duration-200 group-hover:-translate-y-px group-hover:translate-x-px ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 9 L9 3 M4.2 3 H9 V7.8" />
    </svg>
  )
}
