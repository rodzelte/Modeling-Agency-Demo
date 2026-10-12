import { formatDate } from "@/lib/format";
import { getSubscription, requirePortal } from "@/features/portal/context";

export const metadata = { title: "Membership" };

const STATUS: Record<string, string> = { trialing: "Trial", active: "Active", past_due: "Payment overdue", canceled: "Canceled", expired: "Expired" };
const price = (cents: number | null, currency: string, interval: string) =>
  cents === null ? null : `${new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100)} / ${interval}`;

// What a talent needs to unlock the portal (and the mobile app): their plan and
// status. Online payment opens once the payment provider is connected; until
// then the agency activates memberships from the dashboard.
export default async function PortalSubscribe() {
  const { supabase } = await requirePortal();
  const [subscription, { data: plans }] = await Promise.all([
    getSubscription(),
    supabase.from("subscription_plans").select("key,name,description,price_cents,currency,billing_interval").eq("active", true).order("display_order"),
  ]);
  const current = subscription?.subscription;
  const card = "rounded-xl border border-[var(--line)] bg-white p-5";

  return <div className="space-y-6">
    <div>
      <h1 className="display text-5xl leading-none">Membership</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">{subscription?.entitled
        ? "Your membership is active. Every portal feature is open to you."
        : "Subscribe to unlock bookings, availability, digitals, documents and profile updates."}</p>
    </div>
    {current && <section className={card}>
      <p className="text-[10px] font-800 uppercase tracking-[.14em] text-[var(--muted)]">Your plan</p>
      <p className="mt-2 text-lg font-700">{current.plan} · {STATUS[current.status] ?? current.status}</p>
      {current.current_period_end && <p className="mt-1 text-xs text-[var(--muted)]">{current.status === "canceled" || current.cancel_at ? "Ends" : "Renews"} {formatDate(current.current_period_end)}</p>}
    </section>}
    {!subscription?.entitled && <div className="grid gap-4 sm:grid-cols-2">{(plans ?? []).map((plan) => <section key={plan.key} className={card}>
      <h2 className="text-lg font-700">{plan.name}</h2>
      {price(plan.price_cents, plan.currency, plan.billing_interval) && <p className="mt-1 text-2xl font-800">{price(plan.price_cents, plan.currency, plan.billing_interval)}</p>}
      {plan.description && <p className="mt-2 text-sm text-[var(--muted)]">{plan.description}</p>}
      <p className="mt-4 rounded-md bg-[var(--paper)] px-3 py-2 text-xs text-[var(--muted)]">Online payment opens soon. Until then, ask your agent to activate your membership.</p>
    </section>)}</div>}
  </div>;
}
