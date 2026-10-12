"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useMutation } from "@/lib/use-mutation";

const API = "/api/dashboard/memberships";
const field = "mt-1 w-full rounded-md border border-[#dcdcd6] bg-white px-3 py-2 text-sm";
const label = "text-[10px] font-800 uppercase tracking-[.14em] text-[#6f716b]";

export function RequireSwitch({ required, canManage }: { required: boolean; canManage: boolean }) {
  const { run, pending } = useMutation();
  async function toggle() {
    if (!required && !window.confirm("Talent without an active membership will lose access to bookings, availability, digitals, documents and profile updates in the portal. Turn this on?")) return;
    await run(API, { body: { action: "settings", require_subscription: !required }, success: required ? "Memberships are no longer required" : "Memberships are now required" });
  }
  return <div className="flex flex-wrap items-center gap-3">
    <span className="text-sm"><span className="font-800">{required ? "Required." : "Not required."}</span> {required ? "Talent need an active membership to use the portal." : "Every invited talent can use the full portal."}</span>
    {canManage && <Button variant={required ? "secondary" : "primary"} size="sm" onClick={toggle} disabled={pending}>{required ? "Stop requiring" : "Require membership"}</Button>}
  </div>;
}

type Plan = { key: string; name: string; description: string | null; price_cents: number | null; currency: string; billing_interval: string };

export function PlanForm({ plan }: { plan: Plan }) {
  const { run, pending } = useMutation();
  const [price, setPrice] = useState(plan.price_cents === null ? "" : (plan.price_cents / 100).toFixed(2));
  async function save(form: FormData) {
    const cents = price.trim() === "" ? null : Math.round(Number(price) * 100);
    if (cents !== null && !Number.isFinite(cents)) return;
    await run(API, {
      body: { action: "plan", key: plan.key, name: String(form.get("name") ?? ""), description: String(form.get("description") ?? "") || null, price_cents: cents, currency: plan.currency, billing_interval: String(form.get("interval")) },
      success: "Plan saved",
    });
  }
  return <form action={save} className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
    <label className={label}>Plan name<input name="name" defaultValue={plan.name} required maxLength={80} className={field} /></label>
    <label className={label}>Price ({plan.currency.toUpperCase()})<input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" placeholder="Not set" className={field} /></label>
    <label className={label}>Billed<select name="interval" defaultValue={plan.billing_interval} className={field}><option value="month">Monthly</option><option value="year">Yearly</option></select></label>
    <Button type="submit" size="sm" disabled={pending}>Save plan</Button>
    <label className={`${label} sm:col-span-4`}>What it includes<input name="description" defaultValue={plan.description ?? ""} maxLength={500} className={field} /></label>
  </form>;
}

export function GrantButtons({ talentId, planKey, paidOnline, active }: { talentId: string; planKey: string; paidOnline: boolean; active: boolean }) {
  const { run, pending } = useMutation();
  if (paidOnline) return <span className="text-xs text-[#6b6d66]">Paid online</span>;
  if (active) return <Button variant="ghost" size="sm" disabled={pending}
    onClick={() => { if (window.confirm("End this free membership?")) void run(API, { body: { action: "end", talent_id: talentId }, success: "Membership ended" }); }}>End</Button>;
  return <Button variant="secondary" size="sm" disabled={pending} onClick={() => run(API, { body: { action: "grant", talent_id: talentId, plan_key: planKey }, success: "Membership granted" })}>Grant free access</Button>;
}
