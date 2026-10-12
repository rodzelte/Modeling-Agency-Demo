import { NextResponse } from "next/server";
import { databaseError } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";

// Copies a published revision back into the working copy; publish to make it live.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireApi("website.manage");
  if ("response" in auth) return auth.response;
  const { data, error } = await auth.context.supabase.rpc("restore_website_revision", { p_revision_id: id });
  if (error) return databaseError(error, "restore that version");
  return NextResponse.json({ page_id: data });
}
