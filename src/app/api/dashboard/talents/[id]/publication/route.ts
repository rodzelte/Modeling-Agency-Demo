import { NextResponse } from "next/server";
import { databaseError } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import type { Permission } from "@/lib/permissions";
import { firstIssue } from "@/lib/validation";
import { publicationSchema } from "@/features/talent/schemas";
import { refreshPublicSite } from "@/features/public/cache";

const actions = {
  publish: { fields: { publication_status: "published", show_on_website: true }, permission: "talent.publish" },
  unpublish: { fields: { publication_status: "draft", show_on_website: false }, permission: "talent.publish" },
  review: { fields: { publication_status: "review", show_on_website: false }, permission: "talent.publish" },
  draft: { fields: { publication_status: "draft", show_on_website: false }, permission: "talent.publish" },
  archive: { fields: { publication_status: "archived" }, permission: "talent.archive" },
  restore: { fields: { publication_status: "draft" }, permission: "talent.archive" },
} satisfies Record<string, { fields: Record<string, unknown>; permission: Permission }>;

// Publication lifecycle. The database trigger enforces the same permissions and
// writes the audit event (talent.published / unpublished / archived).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = publicationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });

  const change = "action" in parsed.data ? actions[parsed.data.action] : { fields: parsed.data, permission: "talent.publish" as const };
  const auth = await requireApi(change.permission);
  if ("response" in auth) return auth.response;
  refreshPublicSite();

  const { error } = await auth.context.supabase.from("talent").update(change.fields).eq("id", id).select("id").single();
  if (error?.code === "42501") return NextResponse.json({ error: error.message }, { status: 403 });
  if (error) return databaseError(error, "change publication status");
  return NextResponse.json({ ok: true });
}
