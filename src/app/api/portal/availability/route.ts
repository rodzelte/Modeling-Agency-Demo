import { NextResponse } from "next/server";
import { z } from "zod";
import { databaseError } from "@/lib/api";
import { firstIssue } from "@/lib/validation";
import { requireEntitledPortalApi } from "@/features/portal/context";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");
const schema = z.object({ kind: z.enum(["unavailable", "holiday", "available"]).default("unavailable"), start_on: day, end_on: day, note: z.string().trim().max(300).optional() })
  .refine((value) => value.end_on >= value.start_on, { message: "The end date must be on or after the start date", path: ["end_on"] });

export async function POST(request: Request) {
  const auth = await requireEntitledPortalApi();
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  const { supabase, profile } = auth.portal;
  const { error } = await supabase.from("talent_availability").insert({ ...parsed.data, note: parsed.data.note || null, talent_id: profile.id });
  if (error) return databaseError(error, "save your dates");
  return NextResponse.json({ ok: true }, { status: 201 });
}
