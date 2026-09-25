/**
 * The owner's pages beside the workspace: what they know, who can read it,
 * and how it would survive this app. Wider than a document, narrower than the
 * workspace, because these are tables and matrices rather than a canvas.
 */
export default function OwnerPages({ children }: { children: React.ReactNode }) {
  return <main className="w-full px-5 py-10 sm:px-8 lg:px-10">{children}</main>
}
