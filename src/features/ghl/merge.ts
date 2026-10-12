// Three-way merge for one synced field. Pure: unit tested.
//
// base      the value both sides last agreed on (ghl_field_state), or undefined
//           when the field has never been synced for this talent
// dashboard the current dashboard value
// ghl       the incoming GHL value
// All three are normalized strings (see fields.ts) or null for blank.
//
// Rules (docs/ghl-integration.md, "Source of truth"):
// * A blank GHL value never erases dashboard data.
// * GHL unchanged since the last sync → nothing to do inbound. This is also how
//   the echo of our own push is ignored: after a push, base = the pushed value.
// * GHL changed and the dashboard did not (or the field is GHL-only) → apply GHL.
// * Both changed to the same value → just record the agreement.
// * Both changed differently on a bidirectional field → conflict for an admin;
//   nothing is overwritten.
// * Dashboard-only fields are never touched by GHL.
import type { Ownership } from "./fields.ts";

export type MergeDecision =
  | { action: "none" }
  | { action: "apply"; value: string }
  | { action: "agree"; value: string }
  | { action: "conflict"; base: string | null; dashboard: string; ghl: string };

export function decideInbound(ownership: Ownership, base: string | null | undefined, dashboard: string | null, ghl: string | null): MergeDecision {
  if (ownership === "dashboard_only" || ghl === null) return { action: "none" };
  if (base !== undefined && ghl === base) return { action: "none" };
  if (dashboard === ghl) return { action: "agree", value: ghl };
  if (ownership === "ghl_only" || dashboard === null) return { action: "apply", value: ghl };
  if (base !== undefined && dashboard === base) return { action: "apply", value: ghl };
  return { action: "conflict", base: base ?? null, dashboard, ghl };
}

// Outbound: push a bidirectional field when the dashboard moved away from the
// agreed value. A blank dashboard value is never pushed (it would erase GHL data).
export function shouldPush(ownership: Ownership, base: string | null | undefined, dashboard: string | null): boolean {
  return ownership === "bidirectional" && dashboard !== null && dashboard !== (base ?? null);
}
