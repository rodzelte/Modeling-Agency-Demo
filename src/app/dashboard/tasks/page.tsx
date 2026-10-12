import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { ErrorState, UnauthorizedState } from "@/components/ui/States";
import { requirePage } from "@/lib/agency-auth";
import { log } from "@/lib/log";
import { TasksPanel } from "@/features/operations/components/TasksPanel";
import { listTasks, teamMembers } from "@/features/operations/queries";

export const metadata = { title: "Tasks" };

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ view?: string; status?: string }> }) {
  const context = await requirePage("dashboard.access");
  if (!context) return <UnauthorizedState />;
  const search = await searchParams;
  const canSeeAll = context.permissions.has("operations.view");
  const view = canSeeAll && search.view === "all" ? "all" : "mine";
  const status = search.status === "done" ? "done" : "open";
  let data: [Awaited<ReturnType<typeof listTasks>>, Awaited<ReturnType<typeof teamMembers>>];
  try {
    data = await Promise.all([listTasks(context.supabase, { mine: view === "mine" ? context.user.id : undefined, status }), teamMembers(context.supabase)]);
  } catch (error) {
    log.error("operations", "tasks failed", error);
    return <ErrorState title="Tasks could not be loaded" />;
  }
  const tab = (key: string, label: string, params: string, active: boolean) => <Link key={key} href={`/dashboard/tasks?${params}`} aria-current={active ? "page" : undefined}
    className={`rounded-full px-3 py-1.5 text-[10px] font-800 uppercase tracking-[.12em] ${active ? "bg-[#20211f] text-white" : "bg-white text-[#5f615b] ring-1 ring-[#e7e7e3] hover:ring-[#20211f]"}`}>{label}</Link>;

  return <div className="space-y-6">
    <PageHeader eyebrow="Workspace" title="Tasks" description="Follow-ups for the team. Tick a task when it is done." />
    <nav aria-label="Task filters" className="flex flex-wrap gap-1.5">
      {tab("mine-open", "My open tasks", "view=mine", view === "mine" && status === "open")}
      {canSeeAll && tab("all-open", "All open", "view=all", view === "all" && status === "open")}
      {tab("done", "Done", `view=${view}&status=done`, status === "done")}
    </nav>
    <TasksPanel tasks={data[0]} members={data[1].length ? data[1] : [{ id: context.user.id, name: "Me" }]} viewerId={context.user.id} canAssign={context.permissions.has("operations.manage")} />
  </div>;
}
