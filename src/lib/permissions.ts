// Permission keys granted to roles in public.role_permissions (migration 011 onwards).
// The database is the authority; these keys mirror it for typing and UI decisions.
export const PERMISSIONS = [
  "dashboard.access",
  "talent.view",
  "talent.create",
  "talent.edit",
  "talent.publish",
  "talent.archive",
  "talent.delete",
  "talent.private.view",
  "talent.private.edit",
  "boards.view",
  "boards.manage",
  "boards.assign",
  "measurements.edit",
  "skills.edit",
  "agencies.manage",
  "notes.view",
  "notes.edit",
  "media.view",
  "media.manage",
  "legal.view",
  "legal.edit",
  "banking.view",
  "banking.edit",
  "medical.view",
  "medical.edit",
  "documents.view",
  "documents.manage",
  "operations.view",
  "operations.manage",
  "applications.view",
  "applications.manage",
  "integrations.view",
  "integrations.manage",
  "finance.view",
  "finance.manage",
  "billing.view",
  "billing.manage",
  "packages.manage",
  "website.manage",
  "website.publish",
  "audit.view",
  "settings.manage",
  "team.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type PermissionSet = ReadonlySet<Permission>;

export function toPermissionSet(values: unknown): PermissionSet {
  const known = new Set<string>(PERMISSIONS);
  return new Set((Array.isArray(values) ? values : []).filter((value): value is Permission => typeof value === "string" && known.has(value)));
}

export function hasAll(permissions: PermissionSet, required: Permission | Permission[]) {
  return (Array.isArray(required) ? required : [required]).every((permission) => permissions.has(permission));
}
