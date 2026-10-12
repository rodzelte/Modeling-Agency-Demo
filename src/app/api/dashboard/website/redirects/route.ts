import { NextResponse } from "next/server";
import { z } from "zod";
import { databaseError } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { firstIssue } from "@/lib/validation";
import { refreshPublicSite } from "@/features/public/cache";

const redirectSchema = z.object({
  from_path: z.string().trim().max(300).regex(/^\/[^\s]*$/, "The old address must start with /").transform((value) => (value.length > 1 ? value.replace(/\/+$/, "") : value)),
  to_path: z.string().trim().max(500).regex(/^(\/(?![/\\])[^\s]*|https:\/\/[^\s]+)$/, "Send visitors to a path like /models or an https:// link"),
  permanent: z.boolean().default(true),
  is_active: z.boolean().default(true),
});

export async function POST(request: Request) {
  const auth = await requireApi("website.manage");
  if ("response" in auth) return auth.response;
  const parsed = redirectSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  if (parsed.data.from_path === parsed.data.to_path) return NextResponse.json({ error: "A redirect cannot point to itself" }, { status: 400 });
  refreshPublicSite();
  const { error } = await auth.context.supabase.from("website_redirects").insert(parsed.data);
  if (error?.code === "23505") return NextResponse.json({ error: "That old address already has a redirect" }, { status: 409 });
  if (error) return databaseError(error, "add the redirect");
  return NextResponse.json({ ok: true }, { status: 201 });
}
