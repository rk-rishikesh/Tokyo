import { explorerTree } from '@/lib/explorerTree'
import { NamespaceSidebar } from './NamespaceSidebar'

/**
 * The explorer, as a project dashboard: namespaces down the left, the one you
 * picked on the right. `/namespaces` and every `/k/<name>` page share it, so
 * moving between namespaces keeps your place in the tree.
 */
export async function ExplorerShell({ children }: { children: React.ReactNode }) {
  const nodes = await explorerTree().catch(() => [])
  return (
    <div className="lg:flex">
      {/* 61px is the site header, which stays pinned above both columns. */}
      <aside className="border-b border-line bg-bg lg:sticky lg:top-[61px] lg:h-[calc(100vh-61px)] lg:w-[288px] lg:shrink-0 lg:border-b-0 lg:border-r">
        <NamespaceSidebar nodes={nodes} />
      </aside>
      <div className="min-w-0 flex-1 px-5 py-8 sm:px-8 lg:px-10">{children}</div>
    </div>
  )
}
