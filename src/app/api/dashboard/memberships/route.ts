import { NextResponse } from "next/server";
import { z } from "zod";
import { databaseError } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { firstIssue } from "@/lib/validation";

// Dashboard → Memberships (migration 031). Runs as the signed-in staff member;
// RLS allows billing.manage to change settings and plans, and to grant or end
// complimentary access ('manual' rows). Payment-provider rows are never written
// here. Every change to a subscription is audited by a database trigger.
const planKey = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("settings"), require_subscription: z.boolean(), grace_days: z.number().int().min(0).max(60).optional() }),
  z.object({
    action: z.literal("plan"), key: planKey, name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(500).nullable().optional(), price_cents: z.number().int().min(0).max(10_000_000).nullable(),
    currency: z.string().regex(/^[a-z]{3}$/).default("usd"), billing_interval: z.enum(["month", "year"]),
  }),
  z.object({ action: z.literal("grant"), talent_id: z.uuid(), plan_key: planKey, ends_on: z.iso.date().nullable().optional(), note: z.string().trim().max(300).nullable().optional() }),
  z.object({ action: z.literal("end"), talent_id: z.uuid() }),
]);

export async function POST(request: Request) {
  const auth = await requireApi("billing.manage");
  if ("response" in auth) return auth.response;
  const { supabase } = auth.context;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  const body = parsed.data;
  const now = new Date().toISOString();

  if (body.action === "settings") {
    const { error } = await supabase.from("billing_settings").update({
      require_subscription: body.require_subscription, ...(body.grace_days !== undefined ? { grace_days: body.grace_days } : {}), updated_at: now,
    }).eq("id", true);
    if (error) return databaseError(error, "save the membership settings");
    return NextResponse.json({ ok: true });
  }
  if (body.action === "plan") {
    const { error } = await supabase.from("subscription_plans").upsert({
      key: body.key, name: body.name, description: body.description ?? null, price_cents: body.price_cents,
      currency: body.currency, billing_interval: body.billing_interval, updated_at: now,
    }, { onConflict: "key" });
    if (error) return databaseError(error, "save the plan");
    return NextResponse.json({ ok: true });
  }
  if (body.action === "grant") {
    const { data: existing, error: loadError } = await supabase.from("talent_subscriptions").select("provider").eq("talent_id", body.talent_id).maybeSingle();
    if (loadError) return databaseError(loadError, "load the membership");
    if (existing && existing.provider !== "manual") return NextResponse.json({ error: "This talent pays online; manage it with the payment provider" }, { status: 409 });
    const { error } = await supabase.from("talent_subscriptions").upsert({
      talent_id: body.talent_id, plan_key: body.plan_key, status: "active", provider: "manual",
      current_period_end: body.ends_on ? `${body.ends_on}T23:59:59Z` : null, note: body.note ?? null,
    }, { onConflict: "talent_id" });
    if (error) return databaseError(error, "grant the membership");
    return NextResponse.json({ ok: true });
  }
  const { error } = await supabase.from("talent_subscriptions").delete().eq("talent_id", body.talent_id).eq("provider", "manual");
  if (error) return databaseError(error, "end the membership");
  return NextResponse.json({ ok: true });
}
