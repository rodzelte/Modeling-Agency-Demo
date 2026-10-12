import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "@/lib/log";

// Logs the database error server-side and returns a generic message, so table
// names, constraint names, and policy details never reach the browser.
export function databaseError(error: { message?: string; code?: string } | null | undefined, action: string) {
  log.error("api", `${action} failed`, error);
  return NextResponse.json({ error: `Unable to ${action}. Please try again.` }, { status: 500 });
}

// Redirects to an absolute address, or to a path on this site. For a path the
// Location header stays relative, so it is right behind any proxy or domain
// (request.url can carry the server's internal address there). Demo mode's file
// links and pages are site paths; production links are absolute, as before.
export function redirectTo(url: string, status = 307, headers: Record<string, string> = {}) {
  if (url.startsWith("/") && !url.startsWith("//")) return new NextResponse(null, { status, headers: { Location: url, ...headers } });
  return NextResponse.redirect(url, { status, headers });
}

type AuditEvent = {
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
};

// Writes to audit_logs through the write_audit() database function, which records
// the caller as the actor. Failures are logged rather than silently dropped.
export async function writeAudit(supabase: SupabaseClient, event: AuditEvent) {
  const { error } = await supabase.rpc("write_audit", {
    p_action: event.action,
    p_entity_type: event.entityType,
    p_entity_id: event.entityId ?? null,
    p_metadata: event.metadata ?? {},
    p_before: event.before ?? null,
    p_after: event.after ?? null,
  });
  if (error) log.error("audit", "write failed", error, { action: event.action });
}
