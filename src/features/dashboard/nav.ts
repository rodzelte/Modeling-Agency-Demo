import type { Permission, PermissionSet } from "@/lib/permissions";

export type NavIcon = "dashboard" | "talent" | "applications" | "bookings" | "requests" | "boards" | "search" | "calendar" | "tasks" | "companies" | "contacts" | "packages" | "finance" | "website" | "settings" | "ghl" | "import";

export type NavItem = { href: string; label: string; icon: NavIcon; anyOf: Permission[]; phase?: string };
export type NavSection = { title: string; items: NavItem[] };

// Menu items appear when the user holds any listed permission. Pages enforce the
// same permissions server-side; hiding an item is never the security boundary.
export const dashboardNav: NavSection[] = [
  {
    title: "Workspace",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: "dashboard", anyOf: ["dashboard.access"] },
      { href: "/dashboard/talent", label: "Talent", icon: "talent", anyOf: ["talent.view"] },
      { href: "/dashboard/applications", label: "Applications", icon: "applications", anyOf: ["applications.view"] },
      { href: "/dashboard/requests", label: "Talent requests", icon: "requests", anyOf: ["talent.private.view", "media.manage"] },
      { href: "/dashboard/boards", label: "Boards", icon: "boards", anyOf: ["boards.view"] },
      { href: "/dashboard/search", label: "Search", icon: "search", anyOf: ["talent.view"] },
      { href: "/dashboard/bookings", label: "Bookings", icon: "bookings", anyOf: ["operations.view"] },
      { href: "/dashboard/calendar", label: "Calendar", icon: "calendar", anyOf: ["operations.view"] },
      { href: "/dashboard/tasks", label: "Tasks", icon: "tasks", anyOf: ["dashboard.access"] },
    ],
  },
  {
    title: "Relationships",
    items: [
      { href: "/dashboard/companies", label: "Companies", icon: "companies", anyOf: ["operations.view"] },
      { href: "/dashboard/contacts", label: "Contacts", icon: "contacts", anyOf: ["operations.view"] },
      { href: "/dashboard/packages", label: "Packages", icon: "packages", anyOf: ["packages.manage"] },
    ],
  },
  {
    title: "Administration",
    items: [
      { href: "/dashboard/finance", label: "Finance", icon: "finance", anyOf: ["finance.view"] },
      { href: "/dashboard/memberships", label: "Memberships", icon: "packages", anyOf: ["billing.view"] },
      { href: "/dashboard/website", label: "Website", icon: "website", anyOf: ["website.manage"] },
      { href: "/dashboard/ghl", label: "GHL Sync", icon: "ghl", anyOf: ["integrations.view"] },
      { href: "/dashboard/cds", label: "CDS Import", icon: "import", anyOf: ["integrations.manage"] },
      { href: "/dashboard/settings", label: "Settings", icon: "settings", anyOf: ["team.manage", "settings.manage", "audit.view"] },
    ],
  },
];

export function visibleNav(permissions: PermissionSet): NavSection[] {
  return dashboardNav
    .map((section) => ({ ...section, items: section.items.filter((item) => item.anyOf.some((permission) => permissions.has(permission))) }))
    .filter((section) => section.items.length > 0);
}
