"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CheckboxField, SelectField, TextareaField, TextField } from "@/components/ui/Field";
import { Card } from "@/components/ui/PageHeader";
import { formatDateTime } from "@/lib/format";
import { useMutation } from "@/lib/use-mutation";
import { BOOKING_STATUSES, BOOKING_TYPES, LABELS } from "../schemas";
import type { Conflict } from "../bookings";

type Option = { id: string; name: string };
type Booking = { id: string; title: string; booking_type: string; status: string; company_id: string | null; contact_id: string | null; start_at: string; end_at: string; all_day: boolean; location: string | null; usage_terms: string | null; notes: string | null };

// datetime-local wants "YYYY-MM-DDTHH:mm" in the viewer's local time.
function toLocalInput(iso: string | undefined, dateOnly = false) {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return dateOnly ? day : `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function toIso(value: string, allDay: boolean, end: boolean) {
  if (!value) return "";
  const local = allDay ? `${value.slice(0, 10)}T${end ? "23:59" : "00:00"}` : value;
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function BookingForm({ booking, initial, talentIds: initialTalent = [], talent, companies, contacts, canManage, defaultTalent }: {
  booking?: Booking; initial?: Partial<Booking>; talentIds?: string[]; talent: { id: string; display_name: string }[]; companies: Option[]; contacts: { id: string; name: string; company_id: string }[]; canManage: boolean; defaultTalent?: string;
}) {
  const router = useRouter();
  const { run, pending } = useMutation();
  const seed: Partial<Booking> | undefined = booking ?? initial;
  const [title, setTitle] = useState(seed?.title ?? "");
  const [type, setType] = useState(seed?.booking_type ?? "shoot");
  const [status, setStatus] = useState(seed?.status ?? "option");
  const [companyId, setCompanyId] = useState(seed?.company_id ?? "");
  const [contactId, setContactId] = useState(seed?.contact_id ?? "");
  const [allDay, setAllDay] = useState(seed?.all_day ?? false);
  const [start, setStart] = useState(toLocalInput(seed?.start_at, seed?.all_day));
  const [end, setEnd] = useState(toLocalInput(seed?.end_at, seed?.all_day));
  const [location, setLocation] = useState(seed?.location ?? "");
  const [usage, setUsage] = useState(seed?.usage_terms ?? "");
  const [notes, setNotes] = useState(seed?.notes ?? "");
  const [selected, setSelected] = useState<string[]>(initialTalent.length ? initialTalent : defaultTalent ? [defaultTalent] : []);
  const [filter, setFilter] = useState("");
  const [conflicts, setConflicts] = useState<Conflict[]>([]);

  const names = useMemo(() => new Map(talent.map((item) => [item.id, item.display_name])), [talent]);
  const matches = filter.trim() ? talent.filter((item) => item.display_name.toLowerCase().includes(filter.trim().toLowerCase()) && !selected.includes(item.id)).slice(0, 8) : [];
  const companyContacts = contacts.filter((contact) => contact.company_id === companyId);
  const startIso = toIso(start, allDay, false);
  const endIso = toIso(end || start, allDay, true);

  // Live double-booking check (debounced).
  useEffect(() => {
    if (!selected.length || !startIso || !endIso || !["option", "confirmed"].includes(status)) return;
    const timer = setTimeout(async () => {
      const response = await fetch("/api/dashboard/bookings/conflicts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ talent_ids: selected, start_at: startIso, end_at: endIso, exclude_booking: booking?.id }) }).catch(() => null);
      const payload = response?.ok ? await response.json().catch(() => null) : null;
      setConflicts(payload?.conflicts ?? []);
    }, 400);
    return () => clearTimeout(timer);
  }, [selected, startIso, endIso, status, booking?.id]);
  const visibleConflicts = selected.length && startIso && endIso && ["option", "confirmed"].includes(status) ? conflicts : [];

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = { title, booking_type: type, status, company_id: companyId, contact_id: contactId, all_day: allDay, start_at: startIso, end_at: endIso, location, usage_terms: usage, notes, talent_ids: selected };
    if (booking) {
      await run(`/api/dashboard/bookings/${booking.id}`, { method: "PATCH", body, success: "Booking saved" });
    } else {
      const created = await run<{ id: string }>("/api/dashboard/bookings", { body, success: "Booking created", refresh: false });
      if (created?.id) router.push(`/dashboard/bookings/${created.id}`);
    }
  }

  async function remove() {
    if (!booking || !window.confirm("Delete this booking? Consider marking it Cancelled instead to keep the history.")) return;
    if (await run(`/api/dashboard/bookings/${booking.id}`, { method: "DELETE", success: "Booking deleted", refresh: false })) router.push("/dashboard/bookings");
  }

  const disabled = !canManage;
  return <form onSubmit={submit} className="space-y-6">
    <Card title="Booking">
      <fieldset disabled={disabled} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField label="Title" name="title" required className="sm:col-span-2" value={title} onChange={setTitle} placeholder="e.g. Acme swim campaign" />
        <SelectField label="Type" name="booking_type" value={type} onChange={setType} options={BOOKING_TYPES.map((value) => ({ value, label: LABELS.booking[value] }))} />
        <SelectField label="Status" name="status" value={status} onChange={setStatus} options={BOOKING_STATUSES.map((value) => ({ value, label: LABELS.status[value] }))} hint="Talent logins see confirmed bookings only." />
        <SelectField label="Client / company" name="company_id" value={companyId} onChange={(value) => { setCompanyId(value); setContactId(""); }} options={companies.map((company) => ({ value: company.id, label: company.name }))} placeholder="—" />
        <SelectField label="Contact" name="contact_id" value={contactId} onChange={setContactId} options={companyContacts.map((contact) => ({ value: contact.id, label: contact.name }))} placeholder={companyId ? "—" : "Choose a company first"} disabled={!companyId || disabled} />
        <CheckboxField label="All day" name="all_day" className="sm:col-span-2" checked={allDay} onChange={(checked) => { setAllDay(checked); setStart(start.slice(0, 10) + (checked ? "" : "T09:00")); setEnd((end || start).slice(0, 10) + (checked ? "" : "T17:00")); }} />
        <TextField label="Starts" name="start_at" type={allDay ? "date" : "datetime-local"} required value={start} onChange={setStart} />
        <TextField label="Ends" name="end_at" type={allDay ? "date" : "datetime-local"} required value={end} onChange={setEnd} hint={allDay ? undefined : "Times are in your local time zone."} />
        <TextField label="Location" name="location" className="sm:col-span-2" value={location} onChange={setLocation} />
        <TextareaField label="Usage / rights" name="usage_terms" rows={2} className="sm:col-span-2" value={usage} onChange={setUsage} />
        <TextareaField label="Notes" name="notes" rows={3} className="sm:col-span-2" value={notes} onChange={setNotes} />
      </fieldset>
    </Card>

    <Card title={`Talent (${selected.length})`} description="Everyone booked on this job.">
      <ul className="mb-3 flex flex-wrap gap-2">{selected.map((id) => <li key={id} className="inline-flex items-center gap-1.5 rounded-full bg-[#efefeb] py-1 pl-3 pr-1.5 text-xs font-700">
        {names.get(id) ?? "Unknown talent"}
        {canManage && <button type="button" aria-label={`Remove ${names.get(id)}`} onClick={() => setSelected(selected.filter((item) => item !== id))} className="rounded-full p-0.5 hover:bg-white"><X size={12} /></button>}
      </li>)}{!selected.length && <li className="text-sm text-[#6b6d66]">No talent yet.</li>}</ul>
      {canManage && <div className="relative max-w-md">
        <label className="flex items-center gap-2 rounded-md border border-[#dcdcd6] bg-white px-3 py-2"><Search size={14} className="text-[#6b6d66]" aria-hidden /><span className="sr-only">Find talent</span>
          <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Add talent by name" className="w-full text-sm outline-none" /></label>
        {matches.length > 0 && <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-[#e7e7e3] bg-white shadow-lg">{matches.map((item) => <li key={item.id}>
          <button type="button" onClick={() => { setSelected([...selected, item.id]); setFilter(""); }} className="block w-full px-3 py-2 text-left text-sm hover:bg-[#f7f7f5]">{item.display_name}</button>
        </li>)}</ul>}
      </div>}
      {visibleConflicts.length > 0 && <div role="alert" className="mt-4 rounded-lg border border-[#f0d9b5] bg-[#fdf6ea] p-3 text-sm">
        <p className="flex items-center gap-2 font-700 text-[#94692c]"><AlertTriangle size={15} aria-hidden />Possible double booking</p>
        <ul className="mt-2 space-y-1 text-xs text-[#6f5a35]">{visibleConflicts.map((conflict) => <li key={`${conflict.kind}-${conflict.record_id}-${conflict.talent_id}`}>
          <strong>{names.get(conflict.talent_id) ?? "Talent"}</strong>: {conflict.label} ({conflict.status}) · {formatDateTime(conflict.start_at)} – {formatDateTime(conflict.end_at)}
        </li>)}</ul>
      </div>}
    </Card>

    {canManage && <div className="flex flex-wrap justify-between gap-2">
      {booking ? <Button variant="danger" icon={<Trash2 size={14} />} onClick={remove} disabled={pending}>Delete</Button> : <span />}
      <Button type="submit" disabled={pending || !title || !startIso}>{pending ? "Saving…" : booking ? "Save booking" : "Create booking"}</Button>
    </div>}
  </form>;
}
