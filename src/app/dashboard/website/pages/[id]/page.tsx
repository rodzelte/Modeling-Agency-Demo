import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { ErrorState, UnauthorizedState } from "@/components/ui/States";
import { requirePage } from "@/lib/agency-auth";
import { log } from "@/lib/log";
import { getEditorPage } from "@/features/cms/queries";
import { PageEditor } from "@/features/cms/components/PageEditor";
import { buildBoardTree, BOARD_COLUMNS, type BoardRow } from "@/features/boards/tree";

export const metadata = { title: "Edit page" };

export default async function EditWebsitePage({ params }: { params: Promise<{ id: string }> }) {
  const context = await requirePage("website.manage");
  if (!context) return <UnauthorizedState />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  let data: Awaited<ReturnType<typeof getEditorPage>>;
  let boards: { path: string; label: string }[] = [];
  try {
    const [page, boardRows] = await Promise.all([getEditorPage(context.supabase, id), context.supabase.from("boards").select(BOARD_COLUMNS)]);
    data = page;
    boards = buildBoardTree((boardRows.data ?? []) as BoardRow[]).flat.filter((board) => board.isPublic).map((board) => ({ path: board.path, label: board.label }));
  } catch (error) {
    log.error("cms", "editor load failed", error);
    return <ErrorState title="This page could not be loaded" />;
  }
  if (!data) notFound();

  return <div className="space-y-4">
    <Link href="/dashboard/website" className="inline-flex items-center gap-2 text-xs text-[#6b6d66] hover:text-[#20211f]"><ArrowLeft size={14} aria-hidden />All pages</Link>
    <PageHeader eyebrow="Website page" title={data.page.title} description={`/${data.page.slug}`} />
    <PageEditor page={data.page} revisions={data.revisions} boards={boards} canPublish={context.permissions.has("website.publish")} />
  </div>;
}
