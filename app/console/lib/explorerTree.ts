/**
 * The explorer's sidebar: every namespace this deployment knows about, as a
 * tree, in a shape a client component can take.
 *
 * Names it knows but cannot read — encrypted ones it holds no key for — are
 * kept, marked unreadable, so the tree shows the network as it is rather than
 * only the part this explorer happens to be able to open.
 */
import { defaultBranch, knownNamespaces, loadAll, openProposals, snapshotOf, tree, versionOf, type Tree } from './repoview'

export type NavNode = {
  name: string
  title?: string
  /** False for a name that only groups others, or one this explorer cannot open. */
  readable: boolean
  sealed: boolean
  local: boolean
  version?: number
  claims?: number
  open?: number
  children: NavNode[]
}

let cache: { at: number; nodes: NavNode[] } | null = null

export async function explorerTree(): Promise<NavNode[]> {
  // Every page of the explorer renders the sidebar; a short cache keeps it from
  // resolving every namespace on ENS for each click.
  if (cache && Date.now() - cache.at < 60_000) return cache.nodes
  const views = await loadAll()
  const toNode = (t: Tree): NavNode => {
    const v = t.view
    const readable = !!v && (v.source === 'ens' || Object.keys(snapshotOf(v, defaultBranch(v))).length > 0)
    return {
      name: t.name,
      ...(v?.refs.title ? { title: v.refs.title } : {}),
      readable,
      sealed: v?.refs.policy.readers === 'key',
      local: !!v && v.source !== 'ens',
      ...(readable ? { version: versionOf(v!, defaultBranch(v!)), claims: Object.keys(snapshotOf(v!, defaultBranch(v!))).length, open: openProposals(v!).length } : {}),
      children: t.children.map(toNode),
    }
  }
  const nodes = tree(views).map(toNode)

  // Known but unreadable: hang each under its parent when the parent is listed.
  const all = (ns: NavNode[]): NavNode[] => ns.flatMap((n) => [n, ...all(n.children)])
  for (const name of knownNamespaces().filter((n) => !views.some((v) => v.namespace === n))) {
    const node: NavNode = { name, readable: false, sealed: true, local: false, children: [] }
    const parentName = name.split('.').slice(1).join('.')
    let parent = all(nodes).find((n) => n.name === parentName)
    // A parent whose every child is encrypted was never loaded, so it has no row yet:
    // give it one (a group), rather than listing its children loose at the top.
    if (!parent && parentName.includes('.')) {
      parent = { name: parentName, readable: false, sealed: false, local: false, children: [] }
      nodes.push(parent)
    }
    if (parent) parent.children.push(node); else nodes.push(node)
  }
  nodes.sort((a, b) => a.name.localeCompare(b.name))
  cache = { at: Date.now(), nodes }
  return nodes
}
