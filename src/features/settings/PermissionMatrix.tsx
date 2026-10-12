"use client";

import { Check } from "lucide-react";
import { useMutation } from "@/lib/use-mutation";

// Owners toggle permissions per role; everyone else sees the matrix read-only.
// The owner column is fixed (always everything) and talent logins never hold
// staff permissions.
export function PermissionMatrix({ roles, permissions, granted, canEdit }: {
  roles: string[]; permissions: { key: string; description: string }[]; granted: string[]; canEdit: boolean;
}) {
  const { run, pending } = useMutation();
  const set = new Set(granted);
  const locked = (role: string) => role === "owner" || role === "talent";

  return <div className="relative overflow-x-auto">
    <table className="w-full min-w-[820px] text-left text-xs">
      <thead><tr className="border-b border-[#efefeb] text-[9px] font-800 uppercase tracking-[.1em] text-[#6b6d66]"><th className="py-2 pr-4">Permission</th>{roles.map((role) => <th key={role} className="px-2 py-2 text-center">{role.replace("_", " ")}</th>)}</tr></thead>
      <tbody>{permissions.map((permission) => <tr key={permission.key} className="border-b border-[#f3f3f0]">
        <td className="py-2 pr-4"><p className="font-700">{permission.key}</p><p className="text-[11px] text-[#6b6d66]">{permission.description}</p></td>
        {roles.map((role) => {
          const on = set.has(`${role}:${permission.key}`);
          if (!canEdit || locked(role)) return <td key={role} className="px-2 py-2 text-center">{on ? <Check size={14} className="mx-auto text-[#4f7a54]" aria-label="Granted" /> : <span className="text-[#d4d4ce]" aria-label="Not granted">—</span>}</td>;
          return <td key={role} className="px-2 py-2 text-center">
            <input type="checkbox" checked={on} disabled={pending} aria-label={`${permission.key} for ${role.replace("_", " ")}`} className="h-4 w-4 accent-[#20211f]"
              onChange={() => {
                const sensitive = /^(banking|legal|medical|finance|team|talent\.private)/.test(permission.key);
                if (!on && sensitive && !window.confirm(`Give every ${role.replace("_", " ")} access to ${permission.key}? This is sensitive data.`)) return;
                void run("/api/dashboard/permissions", { body: { role, permission: permission.key, granted: !on }, success: on ? "Permission removed" : "Permission granted" });
              }} />
          </td>;
        })}
      </tr>)}</tbody>
    </table>
  </div>;
}
