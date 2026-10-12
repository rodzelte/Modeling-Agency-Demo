import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState, UnauthorizedState } from "@/components/ui/States";
import { requirePage } from "@/lib/agency-auth";
import type { Permission } from "@/lib/permissions";
import { dashboardNav } from "./nav";

// Shell page for a module whose phase has not started. Access is still enforced
// server-side so the route behaves like the finished module will.
export async function ModulePlaceholder({ href, description }: { href: string; description: string }) {
  const item = dashboardNav.flatMap((section) => section.items).find((entry) => entry.href === href);
  if (!item) return <UnauthorizedState />;
  const allowed = await Promise.all(item.anyOf.map((permission: Permission) => requirePage(permission)));
  if (!allowed.some(Boolean)) return <UnauthorizedState />;

  return <div className="space-y-8">
    <PageHeader eyebrow={item.phase ?? "Module"} title={item.label} description={description} />
    <EmptyState title={`${item.label} is scheduled for ${item.phase ?? "a later phase"}`}>
      This area of the workspace is reserved in the navigation and protected by permissions. Its records and workflows arrive in the phase shown above.
    </EmptyState>
  </div>;
}
