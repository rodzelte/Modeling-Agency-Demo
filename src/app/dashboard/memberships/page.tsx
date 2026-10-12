import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card, PageHeader } from "@/components/ui/PageHeader";
import { ErrorState, UnauthorizedState } from "@/components/ui/States";
import { requirePage } from "@/lib/agency-auth";
import { formatDate } from "@/lib/format";
import { log } from "@/lib/log";
import { GrantButtons, PlanForm, RequireSwitch } from "@/features/billing/MembershipControls";

export const metadata = { title: "Memberships" };

const STATUS: Record<string, string> = { trialing: "Trial", active: "Active", past_due: "Payment overdue", canceled: "Canceled", expired: "Expired" };

// Talent memberships (migration 031): whether the portal requires one, the plan,
// and who has access. Online payment is not connected yet; staff grant access.
export default async function MembershipsPage() {
  const context = await requirePage("billing.view");
  if (!context) return <UnauthorizedState />;
  const { supabase, permissions } = context;
  const canManage = permissions.has("billing.manage");

  let data;
  try {
    const [settings, plans, members, subscriptions] = await Promise.all([
      supabase.from("billing_settings").select("require_subscription,grace_days").eq("id", true).maybeSingle(),
      supabase.from("subscription_plans").select("key,name,description,price_cents,currency,billing_interval,active").order("display_order"),
      supabase.from("agency_members").select("talent_id,email,status,talent:talent_id(display_name)").eq("role", "talent").not("talent_id", "is", null).order("email"),
      supabase.from("talent_subscriptions").select("talent_id,plan_key,status,provider,current_period_end"),
    ]);
    for (const result of [settings, plans, members, subscriptions]) if (result.error) throw result.error;
    data = { settings: settings.data, plans: plans.data ?? [], members: members.data ?? [], subscriptions: subscriptions.data ?? [] };
  } catch (error) {
    log.error("billing", "memberships overview failed", error);
    return <ErrorState title="Memberships could not be loaded" />;
  }
  const plan = data.plans.find((p) => p.active) ?? data.plans[0];
  const subscriptionOf = new Map(data.subscriptions.map((s) => [s.talent_id, s]));

  return <div className="space-y-6">
    <PageHeader eyebrow="Administration" title="Memberships" description="Talent sign in to the portal (and, later, the mobile app). When a membership is required, they must subscribe before they can use its features." />
    <Card title="Membership requirement"><RequireSwitch required={Boolean(data.settings?.require_subscription)} canManage={canManage} /></Card>
    {plan && <Card title="Plan" description="Shown to talent on their Membership page. Online payment (Stripe) is not connected yet, so talent are told to ask their agent; grant access below.">
      {canManage ? <PlanForm plan={plan} /> : <p className="text-sm">{plan.name}</p>}
    </Card>}
    <Card title="Talent with portal access" description="Invite talent from their profile's Portal tab first.">
      {data.members.length ? <div className="relative overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm">
        <thead><tr className="border-b border-[#efefeb] text-[9px] font-800 uppercase tracking-[.14em] text-[#6b6d66]"><th className="py-2 pr-4">Talent</th><th className="py-2 pr-4">Membership</th><th className="py-2 pr-4">Until</th><th className="py-2"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{data.members.map((member) => {
          const sub = subscriptionOf.get(member.talent_id);
          const active = Boolean(sub && ["trialing", "active", "past_due"].includes(sub.status));
          const name = (member.talent as unknown as { display_name: string } | null)?.display_name ?? member.email;
          return <tr key={member.talent_id} className="border-b border-[#f3f3f0] last:border-0">
            <td className="py-2 pr-4"><Link href={`/dashboard/talent/${member.talent_id}`} className="font-700 hover:underline">{name}</Link><span className="block text-[11px] text-[#6b6d66]">{member.email}{member.status !== "active" ? ` · ${member.status}` : ""}</span></td>
            <td className="py-2 pr-4">{sub ? <Badge tone={active ? "public" : "draft"}>{`${STATUS[sub.status] ?? sub.status}${sub.provider === "manual" ? " · free" : ""}`}</Badge> : <Badge tone="draft">None</Badge>}</td>
            <td className="py-2 pr-4 text-xs text-[#6b6d66]">{sub?.current_period_end ? formatDate(sub.current_period_end) : "—"}</td>
            <td className="py-2 text-right">{canManage && plan && <GrantButtons talentId={member.talent_id} planKey={plan.key} paidOnline={sub?.provider === "stripe"} active={active} />}</td>
          </tr>;
        })}</tbody>
      </table></div> : <p className="text-sm text-[#6b6d66]">No talent has been invited to the portal yet.</p>}
    </Card>
  </div>;
}
