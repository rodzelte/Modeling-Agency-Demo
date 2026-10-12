import { CRM_STATUS_LABELS, isCrmStatus } from "@/features/ghl/status";

// Program tags ("Model Expo", "Talent Recruitment") show which GHL pipeline a
// model qualified through; the status pill is their normalized CRM status. Both
// come from GHL and are separate from website publication.
const STATUS_TONE: Record<string, string> = {
  active: "bg-[#e4eee5] text-[#4f7a54]", booked: "bg-[#e4eee5] text-[#4f7a54]", enrolled: "bg-[#e3ecf5] text-[#3d6489]",
  graduated: "bg-[#e3ecf5] text-[#3d6489]", accepted: "bg-[#f7ecd8] text-[#94692c]", screening: "bg-[#f7ecd8] text-[#94692c]",
  applicant: "bg-[#efefeb] text-[#5f615b]", lead: "bg-[#efefeb] text-[#5f615b]", inactive: "bg-[#efefeb] text-[#717369]",
  rejected: "bg-[#f8e8df] text-[#a9593d]", archived: "bg-[#ecebf3] text-[#6a6789]",
};

export function ProgramTag({ label }: { label: string }) {
  return <span className="inline-flex items-center rounded-md border border-[#20211f] px-2 py-0.5 text-[10px] font-700 tracking-[.02em] text-[#20211f]">{label}</span>;
}

export function CrmStatusPill({ status }: { status: string | null }) {
  if (!status || !isCrmStatus(status)) return null;
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[9px] font-800 uppercase tracking-[.12em] ${STATUS_TONE[status]}`} title="CRM status from GoHighLevel">{CRM_STATUS_LABELS[status]}</span>;
}

export function CrmBadges({ status, programs }: { status: string | null; programs: string[] | null | undefined }) {
  if (!status && !programs?.length) return null;
  return <span className="inline-flex flex-wrap items-center gap-1.5">
    {(programs ?? []).map((program) => <ProgramTag key={program} label={program} />)}
    <CrmStatusPill status={status} />
  </span>;
}
