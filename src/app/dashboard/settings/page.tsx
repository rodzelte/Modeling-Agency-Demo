import Link from "next/link";
import { Card, PageHeader } from "@/components/ui/PageHeader";
import { EmptyState, ErrorState, UnauthorizedState } from "@/components/ui/States";
import { requirePage } from "@/lib/agency-auth";
import { formatDateTime } from "@/lib/format";
import type { Permission } from "@/lib/permissions";
import { TeamPanel, type Member } from "@/features/settings/TeamPanel";
import { PermissionMatrix } from "@/features/settings/PermissionMatrix";
import { describeAction } from "@/features/dashboard/activity";

export const metadata = { title: "Settings" };

const SECTIONS = [
  { key: "team", label: "Team access", permission: "team.manage" },
  { key: "roles", label: "Roles & permissions", permission: "settings.manage" },
  { key: "activity", label: "Activity log", permission: "audit.view" },
] as const satisfies readonly { key: string; label: string; permission: Permission }[];

const ROLE_ORDER = ["owner", "administrator", "talent_manager", "booker", "creative", "accounting", "staff", "read_only", "talent"];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ section?: string; page?: string }> }) {
  const context = await requirePage();
  if (!context) return <UnauthorizedState />;
  const sections = SECTIONS.filter((section) => context.permissions.has(section.permission));
  if (!sections.length) return <UnauthorizedState />;
  const params = await searchParams;
  const requested = SECTIONS.find((section) => section.key === params.section);
  if (requested && !context.permissions.has(requested.permission)) return <UnauthorizedState />;
  const active = requested ?? sections[0];

  return <div className="space-y-6">
    <PageHeader eyebrow="Administration" title="Settings" />
    <nav aria-label="Settings sections" className="flex gap-1 border-b border-[#e7e7e3]">
      {sections.map((section) => <Link key={section.key} href={`/dashboard/settings?section=${section.key}`} aria-current={section.key === active.key ? "page" : undefined}
        className={`border-b-2 px-3 py-3 text-[10px] font-800 uppercase tracking-[.12em] ${section.key === active.key ? "border-[#a4502f] text-[#a4502f]" : "border-transparent text-[#6b6d66] hover:text-[#20211f]"}`}>{section.label}</Link>)}
    </nav>
    {active.key === "team" && <TeamSection supabase={context.supabase} />}
    {active.key === "roles" && <RolesSection supabase={context.supabase} canEdit={context.permissions.has("team.manage")} />}
    {active.key === "activity" && <ActivitySection supabase={context.supabase} page={Math.max(1, Number(params.page) || 1)} />}
  </div>;
}

type Client = NonNullable<Awaited<ReturnType<typeof requirePage>>>["supabase"];

async function TeamSection({ supabase }: { supabase: Client }) {
  const { data, error } = await supabase.from("agency_members").select("id,email,full_name,role,status,user_id,created_at").order("created_at");
  if (error) return <ErrorState title="Team access could not be loaded" />;
  return <TeamPanel members={(data ?? []) as Member[]} />;
}

async function RolesSection({ supabase, canEdit }: { supabase: Client; canEdit: boolean }) {
  const [permissions, grants] = await Promise.all([
    supabase.from("permissions").select("key,module,description").order("module").order("key"),
    supabase.from("role_permissions").select("role_key,permission_key"),
  ]);
  if (permissions.error || grants.error) return <ErrorState title="Permissions could not be loaded" />;
  const roles = ROLE_ORDER.filter((role) => role === "talent" || (grants.data ?? []).some((grant) => grant.role_key === role));

  return <Card title="Permission matrix" description={canEdit ? "Tick to grant a permission to everyone with that role. Changes apply immediately, are enforced by the database, and are logged. The owner always has everything; talent logins never hold staff permissions." : "Enforced by row-level security in the database; the dashboard reads the same matrix. Talent logins see only their own record."}>
    <PermissionMatrix roles={roles} permissions={(permissions.data ?? []).map((permission) => ({ key: permission.key, description: permission.description }))}
      granted={(grants.data ?? []).map((grant) => `${grant.role_key}:${grant.permission_key}`)} canEdit={canEdit} />
  </Card>;
}

async function ActivitySection({ supabase, page }: { supabase: Client; page: number }) {
  const size = 50;
  const { data, error, count } = await supabase.from("audit_logs")
    .select("id,action,entity_type,entity_id,metadata,created_at,actor:actor_id(full_name,email)", { count: "exact" })
    .order("created_at", { ascending: false }).range((page - 1) * size, page * size - 1);
  if (error) return <ErrorState title="The activity log could not be loaded" />;
  if (!data?.length) return <EmptyState title="No activity recorded yet" />;
  const pages = Math.max(1, Math.ceil((count ?? 0) / size));

  return <div className="space-y-4">
    <div className="relative overflow-x-auto rounded-xl border border-[#e7e7e3] bg-white">
      <table className="w-full min-w-[720px] text-left text-xs">
        <caption className="sr-only">Audit log</caption>
        <thead><tr className="border-b border-[#efefeb] text-[9px] font-800 uppercase tracking-[.14em] text-[#6b6d66]"><th className="px-4 py-3">When</th><th className="px-4 py-3">Who</th><th className="px-4 py-3">Action</th><th className="px-4 py-3">Record</th></tr></thead>
        <tbody>{data.map((event) => {
          const actor = (Array.isArray(event.actor) ? event.actor[0] : event.actor) as { full_name: string; email: string } | null;
          return <tr key={event.id} className="border-b border-[#f3f3f0] last:border-0">
            <td className="whitespace-nowrap px-4 py-2.5 text-[#6b6d66]">{formatDateTime(event.created_at)}</td>
            <td className="px-4 py-2.5">{actor?.full_name || actor?.email || "System"}</td>
            <td className="px-4 py-2.5"><span className="font-700">{describeAction(event.action)}</span><span className="block text-[11px] text-[#717369]">{event.action}</span></td>
            <td className="px-4 py-2.5">{event.entity_type === "talent" && event.entity_id ? <Link href={`/dashboard/talent/${event.entity_id}`} className="hover:text-[#a4502f]">Talent record</Link> : event.entity_type}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    {pages > 1 && <p className="flex justify-between text-xs text-[#6b6d66]"><span>Page {page} of {pages}</span><span className="flex gap-3">
      {page > 1 && <Link href={`/dashboard/settings?section=activity&page=${page - 1}`}>Previous</Link>}
      {page < pages && <Link href={`/dashboard/settings?section=activity&page=${page + 1}`}>Next</Link>}
    </span></p>}
  </div>;
}
