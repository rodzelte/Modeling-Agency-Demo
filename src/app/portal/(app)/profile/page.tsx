import { feetInches, formatDate, lengthLabel } from "@/lib/format";
import { requirePortal } from "@/features/portal/context";
import { ChangeRequestButton, WithdrawRequestButton } from "@/features/portal/components/PortalForms";

export const metadata = { title: "Profile" };

const GROUP_LABELS: Record<string, string> = { contact: "Contact details", address: "Address", measurements: "Measurements", social: "Instagram" };

export default async function PortalProfile() {
  const { supabase, profile } = await requirePortal();
  const { data: requests } = await supabase.from("talent_change_requests").select("id,field_group,changes,status,created_at,review_note").order("created_at", { ascending: false }).limit(20);
  const m = profile.measurements;
  const card = "rounded-xl border border-[var(--line)] bg-white p-5";
  const row = (label: string, value: string | null | undefined) => <div key={label}><dt className="text-[10px] font-800 uppercase tracking-[.12em] text-[var(--muted)]">{label}</dt><dd className="mt-0.5 break-words text-sm">{value || <span className="text-[#717369]">—</span>}</dd></div>;
  const section = (title: string, group: "contact" | "address" | "measurements" | "social", rows: [string, string | null | undefined][], current: Record<string, string | number | null | undefined>) =>
    <section className={card}>
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-800">{title}</h2><ChangeRequestButton group={group} current={current} /></div>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">{rows.map(([label, value]) => row(label, value))}</dl>
    </section>;

  return <div className="space-y-6">
    <div><h1 className="display text-5xl leading-none">{profile.display_name}</h1><p className="mt-2 text-sm text-[var(--muted)]">{[profile.location, profile.boards.join(", ")].filter(Boolean).join(" · ")}</p></div>
    {section("Contact details", "contact", [["Email", profile.contact?.email], ["Mobile", profile.contact?.mobile], ["Other phone", profile.contact?.phone], ["Date of birth", profile.contact?.date_of_birth ? formatDate(profile.contact.date_of_birth) : null]], { email: profile.contact?.email, mobile: profile.contact?.mobile, phone: profile.contact?.phone })}
    {section("Address", "address", [["Address", [profile.address?.address_1, profile.address?.address_2].filter(Boolean).join(", ")], ["City", profile.address?.city], ["State", profile.address?.state], ["Postal code", profile.address?.postal_code], ["Country", profile.address?.country]], profile.address ?? {})}
    {section("Measurements", "measurements", [["Height", m?.height_cm ? feetInches(m.height_cm) : null], ["Bust / chest", lengthLabel(m?.bust_cm)], ["Waist", lengthLabel(m?.waist_cm)], ["Hips", lengthLabel(m?.hips_cm)], ["Shoe", m?.shoe_size ? `${m.shoe_size} US` : null], ["Hair", m?.hair_color], ["Eyes", m?.eye_color]], { shoe_size: m?.shoe_size, hair_color: m?.hair_color, eye_color: m?.eye_color })}
    {section("Instagram", "social", [["Handle", profile.instagram]], { instagram: profile.instagram })}

    <section className={card}>
      <h2 className="text-sm font-800">Your requests</h2>
      {requests?.length ? <ul className="mt-3 divide-y divide-[var(--line)] text-sm">{requests.map((request) => <li key={request.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="min-w-0"><p className="font-700">{GROUP_LABELS[request.field_group]}</p><p className="text-xs text-[var(--muted)]">{Object.keys(request.changes as object).join(", ")} · {formatDate(request.created_at)}{request.review_note ? ` · “${request.review_note}”` : ""}</p></div>
        <span className="flex items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-[9px] font-800 uppercase tracking-[.12em] ${request.status === "approved" ? "bg-[#e4eee5] text-[#4f7a54]" : request.status === "pending" ? "bg-[#f7ecd8] text-[#94692c]" : "bg-[#efefeb] text-[#6f716b]"}`}>{request.status}</span>{request.status === "pending" && <WithdrawRequestButton id={request.id} />}</span>
      </li>)}</ul> : <p className="mt-3 text-sm text-[var(--muted)]">No change requests yet.</p>}
    </section>
  </div>;
}
