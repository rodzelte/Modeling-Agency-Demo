import type { SupabaseClient } from "@supabase/supabase-js";
import { Card } from "@/components/ui/PageHeader";
import { ButtonLink } from "@/components/ui/Button";
import { BookingList } from "@/features/operations/components/BookingList";
import { listBookings } from "@/features/operations/queries";
import { PrivacyPanel } from "@/features/privacy/PrivacyPanel";
import { CrmTab } from "@/features/ghl/components/CrmTab";
import { AvailabilityList, ChangeRequestList, PortalAccessCard, type ChangeRequest } from "@/features/portal/components/StaffPortalPanels";
import type { PermissionSet } from "@/lib/permissions";
import { heightLabel, lengthLabel, formatDate } from "@/lib/format";
import { BoardAssignments } from "@/features/boards/BoardAssignments";
import { toBoardChoice } from "@/features/boards/tree";
import { CollectionManager } from "@/features/media/CollectionManager";
import { PhotoManager } from "@/features/media/PhotoManager";
import { VideoManager } from "@/features/media/VideoManager";
import { loadMedia } from "@/features/media/queries";
import { maskValue, MASKED_BANKING_FIELDS } from "../modules";
import { getAssignedBoardIds, getPrivateDetails, getRecords, getSingleton, loadBoards } from "../queries";
import type { TalentTabKey } from "../tabs";
import type { TalentCore } from "../types";
import { DocumentManager, type TalentDocument } from "./DocumentManager";
import { GeneralTab } from "./GeneralTab";
import { RecordList } from "./RecordList";
import { SingletonForm } from "./SingletonForm";

type Row = Record<string, unknown> & { id: string };
type Props = { tab: TalentTabKey; talent: TalentCore; supabase: SupabaseClient; permissions: PermissionSet };

const EYE_COLORS = ["Blue", "Blue/Green", "Brown", "Dark Brown", "Green", "Grey", "Hazel", "Light Brown", "Black"];
const HAIR_COLORS = ["Black", "Dark Brown", "Brown", "Light Brown", "Auburn", "Red", "Strawberry Blonde", "Dark Blonde", "Blonde", "Platinum Blonde", "Ash Blonde", "Grey", "Salt and Pepper", "White", "Bald"];
const PLATFORMS = ["Instagram", "TikTok", "YouTube", "X", "Facebook", "LinkedIn", "Model Management", "Website"];

// Loads only what the active tab needs, then renders it. RLS decides what each
// query returns; tabs are also hidden and route-guarded by permission.
export async function TalentTabBody({ tab, talent, supabase, permissions }: Props) {
  const id = talent.id;
  const can = (permission: Parameters<PermissionSet["has"]>[0]) => permissions.has(permission);

  switch (tab) {
    case "general": {
      const [privateDetails, boards, assigned, contacts] = await Promise.all([
        can("talent.private.view") ? getPrivateDetails(supabase, id) : null,
        loadBoards(supabase),
        getAssignedBoardIds(supabase, id),
        can("talent.private.view") ? getRecords<Row>(supabase, "talent_contacts", id) : [],
      ]);
      const guardians = contacts.filter((contact) => ["parent", "guardian"].includes(String(contact.relationship))).map((contact) => ({ id: contact.id, name: String(contact.name) }));
      return <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <Card><GeneralTab talent={talent} privateDetails={privateDetails} canEdit={can("talent.edit")} canViewPrivate={can("talent.private.view")} canEditPrivate={can("talent.private.edit")} guardians={guardians} /></Card>
        <Card><BoardAssignments talentId={id} assigned={assigned} canAssign={can("boards.assign")}
          boards={boards.flat.map(toBoardChoice)} /></Card>
      </div>;
    }
    case "other": {
      const [social, methods, rates, legal] = await Promise.all([
        getRecords<Row>(supabase, "talent_social_accounts", id, { column: "platform" }),
        can("talent.private.view") ? getRecords<Row>(supabase, "talent_contact_methods", id) : [],
        can("talent.private.view") ? getRecords<Row>(supabase, "talent_rates", id) : [],
        can("legal.view") ? getSingleton(supabase, "talent_legal", id) : null,
      ]);
      return <div className="space-y-6">
        <Card><RecordList talentId={id} module="social" rows={social} canEdit={can("talent.edit")} datalists={{ "social-platforms": PLATFORMS }} /></Card>
        {can("talent.private.view") && <Card><RecordList talentId={id} module="contact-methods" rows={methods} canEdit={can("talent.private.edit")} /></Card>}
        {can("talent.private.view") && <Card><RecordList talentId={id} module="rates" rows={rates} canEdit={can("talent.private.edit")} /></Card>}
        {can("legal.view") && <Card><SingletonForm talentId={id} module="legal" ui="identification" record={legal} canEdit={can("legal.edit")} description="Passport, visa, and driver license. Restricted to legal roles; never public." /></Card>}
      </div>;
    }
    case "legal":
      return <Card><SingletonForm talentId={id} module="legal" ui="legal" record={await getSingleton(supabase, "talent_legal", id)} canEdit={can("legal.edit")} /></Card>;
    case "banking": {
      const banking = await getSingleton<Record<string, unknown>>(supabase, "talent_banking", id);
      const masked = banking ? { ...banking, ...Object.fromEntries(MASKED_BANKING_FIELDS.map((field) => [field, maskValue(banking[field])])) } : null;
      return <Card><SingletonForm talentId={id} module="banking" ui="banking" record={masked} canEdit={can("banking.edit")} description="Account identifiers are masked. Revealing them is logged." /></Card>;
    }
    case "medical":
      return <Card><SingletonForm talentId={id} module="medical" ui="medical" record={await getSingleton(supabase, "talent_medical", id)} canEdit={can("medical.edit")} description="Highly restricted. Record only what the agency genuinely needs." /></Card>;
    case "addresses":
      return <Card><RecordList talentId={id} module="addresses" rows={await getRecords<Row>(supabase, "talent_addresses", id)} canEdit={can("talent.private.edit")} /></Card>;
    case "contacts":
      return <Card><RecordList talentId={id} module="contacts" rows={await getRecords<Row>(supabase, "talent_contacts", id)} canEdit={can("talent.private.edit")} /></Card>;
    case "agencies": {
      const [rows, agencies] = await Promise.all([getRecords<Row>(supabase, "talent_agencies", id), supabase.from("agencies").select("name").order("name")]);
      return <Card><RecordList talentId={id} module="agencies" rows={rows} canEdit={can("agencies.manage")} datalists={{ "agency-names": (agencies.data ?? []).map((agency) => agency.name) }} /></Card>;
    }
    case "stats": {
      const rows = await getRecords<Row>(supabase, "talent_measurements", id, { column: "measured_on", ascending: false });
      const official = rows.find((row) => row.is_official);
      const current = rows.find((row) => !row.is_official);
      return <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          <MeasurementSummary title="Official measurements" row={official} />
          <MeasurementSummary title="Current / true measurements" row={current} />
        </div>
        <Card><RecordList talentId={id} module="measurements" rows={rows} canEdit={can("measurements.edit")} datalists={{ "eye-colors": EYE_COLORS, "hair-colors": HAIR_COLORS }}
          defaults={{ measured_on: new Date().toISOString().slice(0, 10), is_official: true }} /></Card>
      </div>;
    }
    case "skills": {
      const [rows, categories, skills] = await Promise.all([
        getRecords<Row>(supabase, "talent_skills", id, { column: "category" }),
        supabase.from("skill_categories").select("name").order("sort_order").order("name"),
        supabase.from("skills").select("name").order("name"),
      ]);
      return <Card><RecordList talentId={id} module="skills" rows={rows} canEdit={can("skills.edit")}
        datalists={{ "skill-categories": (categories.data ?? []).map((row) => row.name), "skill-names": [...new Set((skills.data ?? []).map((row) => row.name))] }} /></Card>;
    }
    case "documents":
      return <Card><DocumentManager talentId={id} documents={await getRecords<TalentDocument>(supabase, "talent_documents", id, { column: "created_at", ascending: false })} canManage={can("documents.manage")} /></Card>;
    case "items":
      return <Card><RecordList talentId={id} module="items" rows={await getRecords<Row>(supabase, "talent_items", id, { column: "created_at", ascending: false })} canEdit={can("operations.manage")} /></Card>;
    case "usage":
      return <Card><RecordList talentId={id} module="usages" rows={await getRecords<Row>(supabase, "talent_usages", id, { column: "start_date", ascending: false })} canEdit={can("operations.manage")} /></Card>;
    case "bookings": {
      const [upcoming, past] = await Promise.all([listBookings(supabase, { talent: id, when: "upcoming" }), listBookings(supabase, { talent: id, when: "past" })]);
      return <div className="space-y-6">
        <Card title="Upcoming bookings" actions={<div className="flex gap-2"><a href={`/api/dashboard/calendar/ics?talent=${id}`} className="rounded-md px-3 py-2 text-[10px] font-800 uppercase tracking-[.12em] text-[#5f615b] hover:bg-[#efefeb]">Export .ics</a>{can("operations.manage") && <ButtonLink href={`/dashboard/bookings/new?talent=${id}`} size="sm">New booking</ButtonLink>}</div>}>
          <BookingList rows={upcoming.rows} empty="Nothing booked." />
        </Card>
        <Card title="Past bookings"><BookingList rows={past.rows} empty="No past bookings." /></Card>
      </div>;
    }
    case "appointments":
      return <Card><RecordList talentId={id} module="appointments" rows={await getRecords<Row>(supabase, "talent_appointments", id, { column: "start_at", ascending: false })} canEdit={can("operations.manage")} /></Card>;
    case "notes":
      return <Card><RecordList talentId={id} module="notes" rows={await getRecords<Row>(supabase, "talent_notes", id, { column: "created_at", ascending: false })} canEdit={can("notes.edit")} defaults={{ note_type: "internal" }} /></Card>;
    case "crm":
      return <CrmTab talentId={id} supabase={supabase} canManage={can("integrations.manage")} canResolve={can("integrations.manage") && can("talent.edit") && can("talent.private.edit")} />;
    case "privacy":
      return <PrivacyPanel talentId={id} name={talent.display_name} canErase={can("talent.delete")} />;
    case "portal": {
      const today = new Date().toISOString().slice(0, 10);
      const [access, requests, availability] = await Promise.all([
        supabase.rpc("portal_access", { p_talent_id: id }).then((r) => r.data as { email: string; status: string; signed_up: boolean } | null),
        supabase.from("talent_change_requests").select("id,talent_id,field_group,changes,message,created_at").eq("talent_id", id).eq("status", "pending").order("created_at"),
        supabase.from("talent_availability").select("id,kind,start_on,end_on,note").eq("talent_id", id).gte("end_on", today).order("start_on"),
      ]);
      return <div className="grid gap-6 xl:grid-cols-2">
        <div className="xl:col-span-2"><PortalAccessCard talentId={id} access={access} canEdit={can("talent.private.edit")} /></div>
        <Card title="Change requests" description="Nothing changes until you approve it."><ChangeRequestList requests={(requests.data ?? []) as ChangeRequest[]} /></Card>
        <Card title="Availability" description="Dates the talent has told you about."><AvailabilityList items={availability.data ?? []} /></Card>
      </div>;
    }
    case "media": {
      const media = await loadMedia(supabase, id);
      const canManage = can("media.manage");
      return <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e7e7e3] bg-white px-5 py-4">
          <p className="text-sm text-[#5f615b]">Print-ready comp card from photos approved for public use.</p>
          <ButtonLink href={`/dashboard/talent/${id}/comp-card`} size="sm" variant="secondary">Comp card</ButtonLink>
        </div>
        <Card><PhotoManager talentId={id} photos={media.photos} canManage={canManage} /></Card>
        <Card><CollectionManager talentId={id} kind="portfolio" collections={media.portfolios} photos={media.photos} canManage={canManage} /></Card>
        <Card><CollectionManager talentId={id} kind="book" collections={media.books} photos={media.photos} canManage={canManage} /></Card>
        <Card><VideoManager talentId={id} videos={media.videos} canManage={canManage} /></Card>
      </div>;
    }
  }
}

function MeasurementSummary({ title, row }: { title: string; row: Row | undefined }) {
  const items: [string, string | null][] = row ? [
    ["Height", heightLabel(row.height_cm as number)], ["Chest / bust", lengthLabel(row.bust_chest_cm as number)], ["Waist", lengthLabel(row.waist_cm as number)],
    ["Hips", lengthLabel(row.hips_cm as number)], ["Shoe", (row.shoe_size_us as string) ?? null], ["Eyes", (row.eye_color as string) ?? null], ["Hair", (row.hair_color as string) ?? null],
  ] : [];
  return <Card title={title} description={row ? `Measured ${formatDate(row.measured_on as string)}` : "No snapshot recorded yet."}>
    {row ? <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-4">{items.map(([label, value]) => <div key={label}><dt className="text-[9px] font-800 uppercase tracking-[.12em] text-[#6b6d66]">{label}</dt><dd className="mt-1 font-700">{value || "—"}</dd></div>)}</dl>
      : <p className="text-xs text-[#717369]">Add a measurement snapshot below.</p>}
  </Card>;
}
