import type { Permission, PermissionSet } from "@/lib/permissions";

export const TALENT_TABS = [
  { key: "general", label: "General", permission: "talent.view" },
  { key: "other", label: "Other", permission: "talent.view" },
  { key: "legal", label: "Legal", permission: "legal.view" },
  { key: "addresses", label: "Addresses", permission: "talent.private.view" },
  { key: "contacts", label: "Contacts", permission: "talent.private.view" },
  { key: "banking", label: "Banking", permission: "banking.view" },
  { key: "agencies", label: "Agencies", permission: "talent.view" },
  { key: "stats", label: "Stats", permission: "talent.view" },
  { key: "skills", label: "Skills", permission: "talent.view" },
  { key: "documents", label: "Documents", permission: "documents.view" },
  { key: "items", label: "Items", permission: "operations.view" },
  { key: "bookings", label: "Bookings", permission: "operations.view" },
  { key: "usage", label: "Usage", permission: "operations.view" },
  { key: "appointments", label: "Appointments", permission: "operations.view" },
  { key: "medical", label: "Medical", permission: "medical.view" },
  { key: "notes", label: "Notes", permission: "notes.view" },
  { key: "media", label: "Media", permission: "media.view" },
  { key: "portal", label: "Portal", permission: "talent.private.view" },
  { key: "crm", label: "CRM (GHL)", permission: "integrations.view" },
  { key: "privacy", label: "Privacy", permission: "team.manage" },
] as const satisfies readonly { key: string; label: string; permission: Permission }[];

export type TalentTabKey = (typeof TALENT_TABS)[number]["key"];

export function visibleTabs(permissions: PermissionSet) {
  return TALENT_TABS.filter((tab) => permissions.has(tab.permission));
}
