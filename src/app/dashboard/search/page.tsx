import Link from "next/link";
import { StatusBadge } from "@/components/ui/Badge";
import { Card, PageHeader } from "@/components/ui/PageHeader";
import { EmptyState, UnauthorizedState } from "@/components/ui/States";
import { requirePage } from "@/lib/agency-auth";
import { log } from "@/lib/log";
import { searchSources, type SearchHit } from "@/features/dashboard/search-sources";

export const metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const context = await requirePage("dashboard.access");
  if (!context) return <UnauthorizedState />;
  const q = ((await searchParams).q ?? "").replace(/[,()%*\\:]/g, " ").trim().slice(0, 80);
  const sources = searchSources.filter((source) => context.permissions.has(source.permission));

  const header = <PageHeader eyebrow="Workspace" title="Search" description={`Searches ${sources.map((source) => source.title.toLowerCase()).join(", ") || "nothing you have access to yet"}.`} />;
  const form = <form role="search" className="flex gap-2"><label htmlFor="search-q" className="sr-only">Search</label>
    <input id="search-q" name="q" defaultValue={q} autoFocus placeholder="Name, email, talent ID, location…" className="w-full max-w-xl rounded-md border border-[#dcdcd6] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#a4502f]" />
    <button className="rounded-md bg-[#20211f] px-4 text-[10px] font-800 uppercase tracking-[.12em] text-white">Search</button></form>;
  if (!q) return <div className="space-y-6">{header}{form}<EmptyState title="Type to search the workspace" /></div>;

  const results = await Promise.all(sources.map(async (source) => {
    try {
      return { source, hits: await source.run(context.supabase, q), failed: false };
    } catch (error) {
      log.error("search", "source failed", error, { source: source.key });
      return { source, hits: [] as SearchHit[], failed: true };
    }
  }));

  return <div className="space-y-6">
    {header}{form}
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {results.map(({ source, hits, failed }) => <Card key={source.key} title={`${source.title} (${hits.length})`} className={source.wide ? "lg:col-span-2" : ""}>
        {failed ? <p className="text-xs text-[#a9593d]">This section could not be searched.</p>
          : hits.length ? <ul className="divide-y divide-[#f3f3f0] text-sm">{hits.map((hit) => <li key={hit.id} className="flex items-center justify-between gap-3 py-2.5">
            <Link href={hit.href} className="min-w-0 hover:text-[#a4502f]"><span className="font-700">{hit.title}</span>{hit.subtitle && <span className="block truncate text-[11px] text-[#6b6d66]">{hit.subtitle}</span>}</Link>
            {hit.badge && <StatusBadge status={hit.badge} />}
          </li>)}</ul>
          : <p className="text-xs text-[#717369]">No {source.title.toLowerCase()} match “{q}”.</p>}
      </Card>)}
    </div>
  </div>;
}
