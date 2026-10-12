import { formatDate } from "@/lib/format";
import { requireEntitledPortal } from "@/features/portal/context";
import { AvailabilityForm, RemoveAvailabilityButton } from "@/features/portal/components/PortalForms";

export const metadata = { title: "Availability" };

const LABELS: Record<string, string> = { unavailable: "Not available", holiday: "Holiday", available: "Extra availability" };

export default async function PortalAvailability() {
  const { supabase } = await requireEntitledPortal();
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase.from("talent_availability").select("id,kind,start_on,end_on,note").gte("end_on", today).order("start_on");
  return <div className="space-y-6">
    <div><h1 className="display text-5xl leading-none">Availability</h1><p className="mt-2 text-sm text-[var(--muted)]">Let your agent know when you cannot work, so you are not put forward for those dates.</p></div>
    <AvailabilityForm />
    {data?.length ? <ul className="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] bg-white">{data.map((item) => <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
      <span><span className="font-700">{LABELS[item.kind]}</span> · {formatDate(item.start_on)}{item.end_on !== item.start_on ? ` – ${formatDate(item.end_on)}` : ""}{item.note && <span className="block text-xs text-[var(--muted)]">{item.note}</span>}</span>
      <RemoveAvailabilityButton id={item.id} />
    </li>)}</ul> : <p className="text-sm text-[var(--muted)]">No dates added.</p>}
  </div>;
}
