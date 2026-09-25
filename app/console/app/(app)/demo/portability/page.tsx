import Link from 'next/link'
import { sourceKind, type Knowledge } from '@knowledge01/core'
import { SOURCE_GLYPH } from '@/lib/glyphs'
import { Badge, Card, Empty, PageHeader } from '@/components/ui'
import { defaultBranch, knownNamespaces, loadRepo, logOf, snapshotOf, versionOf, type RepoView } from '@/lib/repoview'
import { Arrow } from '@/components/Arrow'

export const dynamic = 'force-dynamic'

/**
 * Portability, demonstrated rather than asserted (the /compare/memory argument).
 * Reads whatever personal namespaces exist on this machine and shows the claims
 * that came from another assistant's export — each still citing it.
 */
export default async function Portability() {
  // Every namespace on this machine, not a list of one developer's own. The
  // page used to name nine personal namespaces belonging to whoever wrote it,
  // which meant it rendered empty for everybody else — a demonstration of
  // portability that only worked for one person.
  const views = (await Promise.all(knownNamespaces().map((n) => loadRepo(n).catch(() => null)))).filter((v): v is RepoView => !!v)
  const imported: { k: Knowledge; ns: string; vendor: string }[] = []
  for (const v of views) {
    for (const k of Object.values(snapshotOf(v, defaultBranch(v)))) {
      const from = k.sources.find((s) => s.type === 'memory-export')
      if (from) imported.push({ k, ns: v.namespace, vendor: from.name ?? 'an assistant' })
    }
  }
  const vendors = [...new Set(imported.map((i) => i.vendor))]

  return (
    <>
      <PageHeader
        title="Leave the vendor, keep what it learned"
        subtitle={<span>The portability claim, run rather than asserted. A memory export from another assistant becomes claims in namespaces you own — each still citing where it came from. <Badge tone="warn">local demo namespaces</Badge></span>}
      />

      <div className="mb-6 grid gap-3 md:grid-cols-3">
        {[
          ['1 · Export', 'Ask your assistant for your data. Most offer one; what comes back is a file of remembered facts.', 'Settings → Data controls → Export'],
          ['2 · Import', 'Each fact becomes a claim in a namespace you own, routed by subject, citing the export. Nothing is inferred from conversation transcripts.', 'knowledge import memory export.json \\\n  --vendor chatgpt --split --owner you.eth --apply'],
          ['3 · Keep', 'Your next assistant resolves the same names and reads the same versions. Nothing was copied into it; nothing is left behind.', 'knowledge_search({ namespace: "food.you.eth" })'],
        ].map(([t, b, code]) => (
          <Card key={t} className="p-4">
            <p className="text-[15px] font-semibold">{t}</p>
            <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">{b}</p>
            <pre className="mt-3 overflow-x-auto rounded-md bg-muted p-2 font-mono text-[12px] leading-relaxed"><code>{code}</code></pre>
          </Card>
        ))}
      </div>

      {imported.length ? (
        <>
          <Card className="mb-6 p-4">
            <h2 className="text-[15px] font-medium">What came across</h2>
            <p className="mt-1 text-[15px] text-muted-foreground">
              <span className="font-semibold text-foreground">{imported.length}</span> claim{imported.length === 1 ? '' : 's'} from{' '}
              <span className="font-semibold text-foreground">{vendors.join(' and ')}</span>, now in{' '}
              <span className="font-semibold text-foreground">{new Set(imported.map((i) => i.ns)).size}</span> namespaces you own.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {views.filter((v) => imported.some((i) => i.ns === v.namespace)).map((v) => (
                <Link key={v.namespace} href={`/k/${encodeURIComponent(v.namespace)}`} className="rounded-lg border border-border px-3 py-1.5 text-[13.5px] transition-colors hover:border-accent/50">
                  <span className="font-mono">{v.namespace}</span>
                  <span className="ml-2 text-muted-foreground">v{versionOf(v, defaultBranch(v))} · {Object.keys(snapshotOf(v, defaultBranch(v))).length} claims</span>
                </Link>
              ))}
            </div>
          </Card>

          <h2 className="mb-3 text-[15px] font-medium">Every claim, still citing its export</h2>
          <div className="space-y-2">
            {imported.map(({ k, ns, vendor }) => (
              <Card key={`${ns}${k.id}`} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="max-w-3xl text-[15px] leading-relaxed">{k.subject ? <span className="text-muted-foreground">{k.subject} — </span> : null}{k.claim}</p>
                  <Link href={`/k/${encodeURIComponent(ns)}/item/${encodeURIComponent(k.id)}`} className="shrink-0 text-[13.5px] text-accent hover:underline">provenance <Arrow /></Link>
                </div>
                <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] text-muted-foreground">
                  <span className="font-mono">{ns}</span>·
                  {k.sources.map((s, i) => <span key={i}>{SOURCE_GLYPH[sourceKind(s)]} {s.name ?? s.type}</span>)}·
                  <span>{Math.round(k.confidence * 100)}%</span>·
                  <span>owned by {k.contributor}</span>
                  {k.sources.length > 1 ? <Badge tone="added">{k.sources.length} sources agree</Badge> : null}
                </p>
                {k.sources.find((s) => s.excerpt) ? <p className="mt-1 text-[13.5px] italic text-muted-foreground">as {vendor} recorded it: “{k.sources.find((s) => s.excerpt)!.excerpt}”</p> : null}
              </Card>
            ))}
          </div>

          <Card className="mt-6 p-4 text-[15px]">
            <h2 className="mb-2 font-medium">What is different now</h2>
            <ul className="space-y-1.5 text-[14.5px] leading-relaxed text-muted-foreground">
              <li><span className="text-foreground">Portable</span> — the names are yours; any agent that speaks the protocol reads them.</li>
              <li><span className="text-foreground">Immutable</span> — {views.filter((v) => imported.some((i) => i.ns === v.namespace)).reduce((n, v) => n + logOf(v, defaultBranch(v), 1000).length, 0)} versions across these namespaces; a correction is a new version, never an overwrite.</li>
              <li><span className="text-foreground">Sovereign</span> — private and encrypted; you hold the key and can hand it to a second agent without copying anything.</li>
            </ul>
            <p className="mt-3 text-[13.5px] text-muted-foreground">The import is a dry run by default. Export formats differ between vendors and change without notice, so it reads several known shapes and skips what it cannot read rather than guessing — and it never turns conversation transcripts into claims, which would mean inventing statements nobody made. <Link href="/compare/memory" className="text-accent hover:underline">The argument in full <Arrow /></Link></p>
          </Card>
        </>
      ) : (
        <Empty>
          No imported claims on this machine yet. Run{' '}
          <code>knowledge import memory &lt;export.json&gt; --vendor chatgpt --split --owner you.eth --apply</code>{' '}
          and reload.
        </Empty>
      )}
    </>
  )
}
