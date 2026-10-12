import { NextResponse } from "next/server";
import { z } from "zod";
import { databaseError } from "@/lib/api";
import { firstIssue } from "@/lib/validation";
import { requireEntitledPortalApi } from "@/features/portal/context";

const text = (max: number) => z.string().trim().max(max).optional();
const cm = z.coerce.number().min(20).max(250).optional();
const groups = {
  contact: z.object({ email: z.string().trim().max(200).refine((value) => value === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), "Enter a valid email").optional(), mobile: text(40), phone: text(40) }),
  address: z.object({ address_1: text(160), address_2: text(160), city: text(100), state: text(100), postal_code: text(30), country: text(100) }),
  measurements: z.object({ height_cm: cm, bust_cm: cm, waist_cm: cm, hips_cm: cm, shoe_size: text(10), hair_color: text(40), eye_color: text(40) }),
  social: z.object({ instagram: z.string().trim().max(60).regex(/^@?[A-Za-z0-9._]*$/, "Use your Instagram handle, e.g. @name").optional() }),
};
const schema = z.object({ field_group: z.enum(["contact", "address", "measurements", "social"]), changes: z.record(z.string(), z.unknown()), message: z.string().trim().max(1000).optional() });

// Talent ask for a change; staff review it. Nothing changes until approved.
export async function POST(request: Request) {
  const auth = await requireEntitledPortalApi();
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  const changes = groups[parsed.data.field_group].safeParse(parsed.data.changes);
  if (!changes.success) return NextResponse.json({ error: firstIssue(changes.error) }, { status: 400 });
  const values = Object.fromEntries(Object.entries(changes.data).filter(([, value]) => value !== undefined && value !== ""));
  if (!Object.keys(values).length) return NextResponse.json({ error: "Change at least one field" }, { status: 400 });

  const { supabase, profile } = auth.portal;
  const { error } = await supabase.from("talent_change_requests").insert({ talent_id: profile.id, field_group: parsed.data.field_group, changes: values, message: parsed.data.message || null });
  if (error) return databaseError(error, "send the request");
  return NextResponse.json({ ok: true }, { status: 201 });
}
