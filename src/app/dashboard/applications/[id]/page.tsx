import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ImageOff } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Card, PageHeader } from "@/components/ui/PageHeader";
import { ErrorState, UnauthorizedState } from "@/components/ui/States";
import { requirePage } from "@/lib/agency-auth";
import { ageFromDob, formatDate, formatDateTime, heightLabel, lengthLabel } from "@/lib/format";
import { log } from "@/lib/log";
import { applicantName, getApplication } from "@/features/applications/queries";
import { ApplicationActions } from "@/features/applications/components/ApplicationActions";
import { ApplicationNotes } from "@/features/applications/components/ApplicationNotes";
import { ApplicationStatusBadge } from "@/features/applications/components/ApplicationStatusBadge";

export const metadata = { title: "Application" };

const KIND_LABELS: Record<string, string> = { headshot: "Headshot", full_body: "Full body", three_quarter: "3/4", other: "Photo" };

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await requirePage("applications.view");
  if (!context) return <UnauthorizedState />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  let data: Awaited<ReturnType<typeof getApplication>>;
  try {
    data = await getApplication(context.supabase, id, context.permissions);
  } catch (error) {
    log.error("applications", "load failed", error);
    return <ErrorState title="This application could not be loaded" />;
  }
  if (!data) notFound();
  const { application: app, photos, notes, duplicates } = data;
  const canManage = context.permissions.has("applications.manage");
  const canConvert = canManage && context.permissions.has("talent.create") && context.permissions.has("talent.private.edit");
  const age = ageFromDob(app.date_of_birth);

  const rows: [string, string | null][] = [
    ["Email", app.email], ["Phone", app.phone], ["Date of birth", app.date_of_birth ? `${formatDate(app.date_of_birth)}${age !== null ? ` (${age})` : ""}` : null],
    ["Gender", app.gender], ["Address", [app.address, app.city, app.state, app.postal_code, app.country].filter(Boolean).join(", ") || null],
    ["Instagram", app.instagram], ["Height", app.height_cm ? heightLabel(app.height_cm) : null], ["Bust / chest", lengthLabel(app.bust_cm)],
    ["Waist", lengthLabel(app.waist_cm)], ["Hips", lengthLabel(app.hips_cm)], ["Dress size", app.dress_size], ["Shoe size", app.shoe_size],
    ["Hair", app.hair_color], ["Eyes", app.eye_color],
  ];
  const guardian: [string, string | null][] = [["Name", app.guardian_name], ["Email", app.guardian_email], ["Phone", app.guardian_phone]];
  const extra = Object.entries(app.extra_fields ?? {});

  return <div className="space-y-6">
    <Link href="/dashboard/applications" className="inline-flex items-center gap-2 text-xs text-[#6b6d66] hover:text-[#20211f]"><ArrowLeft size={14} aria-hidden />All applications</Link>
    <PageHeader eyebrow={`Application · ${app.source === "ghl" ? "GoHighLevel" : "Manual"}`} title={applicantName(app)}
      description={`Submitted ${formatDateTime(app.submitted_at)}${app.last_received_at !== app.submitted_at ? ` · last update ${formatDateTime(app.last_received_at)}` : ""}`}
      actions={<div className="flex flex-wrap items-center gap-2"><ApplicationStatusBadge status={app.status} />{app.is_minor && <Badge tone="review">Minor — guardian required</Badge>}</div>} />

    {(canManage || app.converted_talent_id) && <ApplicationActions id={app.id} status={app.status} email={app.email} convertedTalentId={app.converted_talent_id} canManage={canManage} canConvert={canConvert} canErase={context.permissions.has("team.manage")} />}

    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-6">
        <Card title="Photos" description="Stored privately. Converting copies them into the talent's private media.">
          {photos.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{photos.map((photo) => <figure key={photo.id} className="min-w-0">
            <div className="relative aspect-[3/4] overflow-hidden rounded-lg bg-[#efefeb]">
              {photo.url
                // Signed, short-lived URL from a private bucket; next/image cannot optimise it.
                // eslint-disable-next-line @next/next/no-img-element
                ? <a href={photo.url} target="_blank" rel="noreferrer"><img src={photo.url} alt={`${applicantName(app)} — ${KIND_LABELS[photo.kind]}`} className="h-full w-full object-cover" loading="lazy" /></a>
                : <div className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center text-[11px] text-[#6b6d66]"><ImageOff size={18} aria-hidden />Not stored{photo.error ? `: ${photo.error}` : ""}{photo.source_url && <a href={photo.source_url} target="_blank" rel="noreferrer" className="underline">Open in GHL</a>}</div>}
            </div>
            <figcaption className="mt-1.5 text-[10px] font-800 uppercase tracking-[.12em] text-[#6b6d66]">{KIND_LABELS[photo.kind] ?? photo.kind}</figcaption>
          </figure>)}</div> : <p className="text-sm text-[#6b6d66]">No photos were attached to this submission.</p>}
        </Card>

        <Card title="Details">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">{rows.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-[10px] font-800 uppercase tracking-[.12em] text-[#6b6d66]">{label}</dt><dd className="mt-0.5 break-words">{value || <span className="text-[#717369]">—</span>}</dd></div>)}</dl>
          {app.message && <div className="mt-5 border-t border-[#efefeb] pt-4"><p className="text-[10px] font-800 uppercase tracking-[.12em] text-[#6b6d66]">Message</p><p className="mt-1 whitespace-pre-line text-sm leading-6">{app.message}</p></div>}
        </Card>

        {extra.length > 0 && <Card title="Other answers" description="Fields from the GHL form without a dedicated column.">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">{extra.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-[10px] font-800 uppercase tracking-[.12em] text-[#6b6d66]">{label}</dt><dd className="mt-0.5 break-words">{value}</dd></div>)}</dl>
        </Card>}
      </div>

      <div className="min-w-0 space-y-6">
        {(app.is_minor || app.guardian_name || app.guardian_email) && <Card title="Parent / guardian">
          <dl className="space-y-3 text-sm">{guardian.map(([label, value]) => <div key={label}><dt className="text-[10px] font-800 uppercase tracking-[.12em] text-[#6b6d66]">{label}</dt><dd className="mt-0.5 break-words">{value || <span className="text-[#717369]">—</span>}</dd></div>)}</dl>
        </Card>}

        <Card title="Consent">
          <p className="text-sm">{app.sms_consent === null ? "No SMS consent answer was received." : app.sms_consent ? "Agreed to receive SMS messages." : "Declined SMS messages."}</p>
          {app.sms_consent_text && <p className="mt-2 text-xs leading-5 text-[#6b6d66]">Wording: “{app.sms_consent_text}”</p>}
        </Card>

        {duplicates.length > 0 && <Card title="Possible duplicates" description="Same email or phone number.">
          <ul className="space-y-2 text-sm">{duplicates.map((item) => <li key={`${item.kind}-${item.id}`}><Link className="hover:text-[#a4502f] hover:underline" href={item.kind === "talent" ? `/dashboard/talent/${item.id}` : `/dashboard/applications/${item.id}`}>{item.kind === "talent" ? "Talent: " : "Application: "}{item.label}</Link></li>)}</ul>
        </Card>}

        <ApplicationNotes id={app.id} notes={notes} canAdd={canManage} />
      </div>
    </div>
  </div>;
}
