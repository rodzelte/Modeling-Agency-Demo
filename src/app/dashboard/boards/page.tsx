import { PageHeader } from "@/components/ui/PageHeader";
import { ErrorState, UnauthorizedState } from "@/components/ui/States";
import { requirePage } from "@/lib/agency-auth";
import { BoardManager } from "@/features/boards/BoardManager";
import { loadBoards } from "@/features/talent/queries";
import { log } from "@/lib/log";

export const metadata = { title: "Boards" };

async function loadBoardPage(supabase: NonNullable<Awaited<ReturnType<typeof requirePage>>>["supabase"]) {
  try {
    const [tree, assignments] = await Promise.all([loadBoards(supabase), supabase.from("talent_board_assignments").select("board_id")]);
    const counts: Record<string, number> = {};
    for (const row of assignments.data ?? []) counts[row.board_id] = (counts[row.board_id] ?? 0) + 1;
    return { ...tree, counts };
  } catch (error) {
    log.error("boards", "load failed", error);
    return null;
  }
}

export default async function BoardsPage() {
  const context = await requirePage("boards.view");
  if (!context) return <UnauthorizedState />;
  const data = await loadBoardPage(context.supabase);
  if (!data) return <ErrorState title="Boards could not be loaded" />;

  return <div className="space-y-6">
    <PageHeader eyebrow="Workspace" title="Boards"
      description="Boards place published talent on the website. A board appears publicly only when it and every parent board are active and published, and it is not internal. Deactivating a board never deletes talent." />
    <BoardManager roots={data.roots} flat={data.flat} counts={data.counts} canManage={context.permissions.has("boards.manage")} />
  </div>;
}
