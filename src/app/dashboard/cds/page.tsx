import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card, PageHeader } from "@/components/ui/PageHeader";
import { ErrorState, UnauthorizedState } from "@/components/ui/States";
import { requirePage } from "@/lib/agency-auth";
import { log } from "@/lib/log";
import { CdsImportPanel } from "@/features/cds/CdsImportPanel";

export const metadata = { title: "CDS Import" };

type Staged = { cds_id: string; first_name: string; last_name: string; match_status: string; match_reason: string | null; talent_id: string | null; portfolios: { name: string }[]; cds_boards: string[] };
const tone = (status: string) => (status === "created" ? "public" : status === "matched" ? "review" : status === "review" ? "internal" : "draft") as "public" | "review" | "internal" | "draft";

// CDS / WebForFashion import (migration 029). Live database counts only.
export default async function CdsImportPage() {
  const context = await requirePage("integrations.manage");
  if (!context) return <UnauthorizedState />;
  const { supabase } = context;
  const head = { count: "exact" as const, head: true };
  const count = (query: PromiseLike<{ count: number | null }>) => Promise.resolve(query).then((result) => result.count ?? 0);

  let data;
  try {
    const [talents, pending, images, digitals, videos, imported, failed, skipped, mappings] = await Promise.all([
      supabase.from("cds_talents").select("cds_id,first_name,last_name,match_status,match_reason,talent_id,portfolios,cds_boards").eq("excluded", false).order("last_name").order("first_name").limit(1000),
      count(supabase.from("cds_talents").select("cds_id", head).eq("match_status", "pending").eq("excluded", false).not("wff_id", "is", null)),
      count(supabase.from("cds_media").select("wff_media_id", head).eq("kind", "image")),
      count(supabase.from("cds_media").select("wff_media_id", head).eq("kind", "digital")),
      count(supabase.from("cds_media").select("wff_media_id", head).eq("kind", "video")),
      count(supabase.from("cds_media").select("wff_media_id", head).eq("status", "imported")),
      count(supabase.from("cds_media").select("wff_media_id", head).eq("status", "failed")),
      count(supabase.from("cds_media").select("wff_media_id", head).eq("status", "skipped")),
      supabase.from("cds_portfolio_boards").select("portfolio_name,mapping_source,board:board_id(name,publish_to_website)").order("portfolio_name"),
    ]);
    // Photos still waiting to be copied, counted only for talents in the dashboard.
    const linked = ((talents.data ?? []) as Staged[]).filter((t) => t.talent_id && ["created", "matched"].includes(t.match_status)).map((t) => t.cds_id);
    const waiting = skipped && linked.length ? await count(supabase.from("cds_media").select("wff_media_id", head).eq("status", "listed").in("cds_id", linked)) : 0;
    data = { talents: (talents.data ?? []) as Staged[], pending, images, digitals, videos, imported, failed, skipped, waiting, mappings: mappings.data ?? [] };
  } catch (error) {
    log.error("cds", "overview failed", error);
    return <ErrorState title="The CDS import status could not be loaded" />;
  }
  const by = (status: string) => data.talents.filter((t) => t.match_status === status).length;
  const listed = data.images + data.digitals + data.videos;
  const skipped = data.skipped;
  const selected = data.imported + data.failed + data.waiting;
  const tiles: [string, number, string][] = [
    ["Talents read from CDS", data.talents.length, "Model Luxe Media and 42 Model Management are skipped"],
    ["Added as new drafts", by("created"), "Not published; review, then publish"],
    ["Already in the dashboard", by("matched"), "Linked; existing details unchanged"],
    ["Need review", by("review"), "Possible duplicates; not added"],
    ["Photos listed", listed, `${data.images} photos · ${data.digitals} digitals · ${data.videos} videos`],
    ["Photos copied", data.imported, skipped ? `of ${selected} selected${data.failed ? ` · ${data.failed} failed` : ""}` : "Not started"],
  ];
  const status = !data.talents.length ? "Not started"
    : data.pending ? `In progress: ${data.pending} talents still to add (step 3)`
    : !skipped ? "Talents added; photos not copied yet (step 4)"
    : data.waiting ? `In progress: ${data.waiting} photos still to copy (step 4)`
    : data.failed ? `Finished, with ${data.failed} photos that could not be copied (run step 4 again to retry)`
    : "Import finished: talents added and photos copied";

  return <div className="space-y-6">
    <PageHeader eyebrow="Administration" title="CDS Import" description="Bring talents, boards and the photo list over from CDS / WebForFashion, using your own CDS sign-in in this browser. Nothing is published automatically." />
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">{tiles.map(([label, value, hint]) => <div key={label} className="min-w-0 rounded-xl border border-[#e7e7e3] bg-white p-4">
      <p className="text-[10px] font-800 uppercase tracking-[.12em] text-[#6b6d66]">{label}</p><p className="mt-2 text-2xl font-800">{value}</p><p className="mt-1 text-[11px] text-[#6b6d66]">{hint}</p>
    </div>)}</div>

    <p className="rounded-lg border border-[#e7e7e3] bg-white px-4 py-3 text-sm"><span className="font-800">Status:</span> {status}</p>

    <Card title="Import" description="1 reads every active talent from CDS, 2 reads their boards, stats, portfolios and photo list from WebForFashion, each in a second window, and saves them here. 3 adds the talents who are not in the dashboard yet, as drafts. 4 copies their photos (portfolios, digitals and the cover, resized) from the WebForFashion window and sets each profile picture.">
      <CdsImportPanel pending={data.pending} />
    </Card>

    {data.mappings.length > 0 && <Card title="CDS portfolios → website boards" description="A talent appears on every board their CDS portfolios map to. New boards were created unpublished: publish them in Boards when ready.">
      <div className="relative overflow-x-auto"><table className="w-full min-w-[480px] text-left text-sm">
        <thead><tr className="border-b border-[#efefeb] text-[9px] font-800 uppercase tracking-[.14em] text-[#6b6d66]"><th className="py-2 pr-4">CDS portfolio</th><th className="py-2 pr-4">Website board</th><th className="py-2">Board status</th></tr></thead>
        <tbody>{data.mappings.map((row) => {
          const board = row.board as unknown as { name: string; publish_to_website: boolean } | null;
          return <tr key={row.portfolio_name} className="border-b border-[#f3f3f0] last:border-0">
            <td className="py-2 pr-4 font-700">{row.portfolio_name}</td>
            <td className="py-2 pr-4">{board?.name ?? "Not on the website"}{row.mapping_source === "created" && <span className="ml-2 text-[11px] text-[#6b6d66]">(new)</span>}</td>
            <td className="py-2">{board ? <Badge tone={board.publish_to_website ? "public" : "draft"}>{board.publish_to_website ? "Published" : "Draft"}</Badge> : null}</td>
          </tr>;
        })}</tbody>
      </table></div>
    </Card>}

    {data.talents.length > 0 && <Card title="Talents from CDS">
      <div className="relative overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm">
        <thead><tr className="border-b border-[#efefeb] text-[9px] font-800 uppercase tracking-[.14em] text-[#6b6d66]"><th className="py-2 pr-4">Talent</th><th className="py-2 pr-4">CDS ID</th><th className="py-2 pr-4">Portfolios</th><th className="py-2 pr-4">Status</th><th className="py-2">Note</th></tr></thead>
        <tbody>{data.talents.map((t) => <tr key={t.cds_id} className="border-b border-[#f3f3f0] last:border-0">
          <td className="py-2 pr-4 font-700">{t.talent_id ? <Link href={`/dashboard/talent/${t.talent_id}`} className="underline-offset-4 hover:underline">{t.first_name} {t.last_name}</Link> : `${t.first_name} ${t.last_name}`}</td>
          <td className="py-2 pr-4 font-mono text-xs">{t.cds_id}</td>
          <td className="py-2 pr-4 text-xs text-[#6b6d66]">{t.portfolios.map((p) => p.name).join(", ") || "—"}</td>
          <td className="py-2 pr-4"><Badge tone={tone(t.match_status)}>{t.match_status === "matched" ? "In dashboard" : t.match_status === "created" ? "Added" : t.match_status}</Badge></td>
          <td className="py-2 text-xs text-[#6b6d66]">{t.match_reason ?? ""}</td>
        </tr>)}</tbody>
      </table></div>
    </Card>}
  </div>;
}
