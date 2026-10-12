import { NextResponse } from "next/server";
import { databaseError } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { BLOCK_DEFAULTS } from "@/features/cms/blocks";
import { validatePageInput } from "@/features/cms/validate";

// Creates a draft page with one text section to start from.
export async function POST(request: Request) {
  const auth = await requireApi("website.manage");
  if ("response" in auth) return auth.response;
  const body = await request.json().catch(() => null);
  const checked = validatePageInput({ ...(body ?? {}), sections: [{ id: "intro", type: "rich_text", data: { ...BLOCK_DEFAULTS.rich_text, heading: body?.title } }] });
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
  const { data, error } = await auth.context.supabase.from("website_pages").insert(checked.value).select("id").single();
  if (error?.code === "23505") return NextResponse.json({ error: "A page already uses that address" }, { status: 409 });
  if (error) return databaseError(error, "create the page");
  return NextResponse.json(data, { status: 201 });
}
