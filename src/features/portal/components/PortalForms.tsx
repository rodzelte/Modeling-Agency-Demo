"use client";

import { useRef, useState } from "react";
import { Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { SelectField, TextareaField, TextField } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { createClient } from "@/lib/supabase/client";
import { useMutation } from "@/lib/use-mutation";

type Group = "contact" | "address" | "measurements" | "social";
type FieldDef = { key: string; label: string; type?: string; hint?: string };

const FIELDS: Record<Group, FieldDef[]> = {
  contact: [{ key: "email", label: "Email", type: "email" }, { key: "mobile", label: "Mobile" }, { key: "phone", label: "Other phone" }],
  address: [{ key: "address_1", label: "Address" }, { key: "address_2", label: "Address line 2" }, { key: "city", label: "City" }, { key: "state", label: "State" }, { key: "postal_code", label: "Postal code" }, { key: "country", label: "Country" }],
  measurements: [
    { key: "height_ft", label: "Height (feet)", type: "number" }, { key: "height_in", label: "Height (inches)", type: "number" },
    { key: "bust_in", label: "Bust / chest (inches)", type: "number" }, { key: "waist_in", label: "Waist (inches)", type: "number" },
    { key: "hips_in", label: "Hips (inches)", type: "number" }, { key: "shoe_size", label: "Shoe size (US)" },
    { key: "hair_color", label: "Hair colour" }, { key: "eye_color", label: "Eye colour" },
  ],
  social: [{ key: "instagram", label: "Instagram handle", hint: "e.g. @yourname" }],
};
const TITLES: Record<Group, string> = { contact: "Update contact details", address: "Update address", measurements: "Update measurements", social: "Update Instagram" };

// Asks for a change. Measurements are entered in feet/inches and sent in cm.
export function ChangeRequestButton({ group, current }: { group: Group; current: Record<string, string | number | null | undefined> }) {
  const { run, pending } = useMutation();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let changes: Record<string, string | number> = { ...values };
    if (group === "measurements") {
      const inch = (value: string | undefined) => (value ? Math.round(Number(value) * 2.54 * 10) / 10 : undefined);
      const height = values.height_ft || values.height_in ? Math.round(((Number(values.height_ft) || 0) * 12 + (Number(values.height_in) || 0)) * 2.54) : undefined;
      changes = Object.fromEntries(Object.entries({ height_cm: height, bust_cm: inch(values.bust_in), waist_cm: inch(values.waist_in), hips_cm: inch(values.hips_in), shoe_size: values.shoe_size, hair_color: values.hair_color, eye_color: values.eye_color })
        .filter(([, value]) => value !== undefined && value !== "")) as Record<string, string | number>;
    }
    if (await run("/api/portal/requests", { body: { field_group: group, changes, message }, success: "Sent to your agent for review" })) { setOpen(false); setValues({}); setMessage(""); }
  }

  return <>
    <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Request a change</Button>
    <Dialog open={open} onClose={() => setOpen(false)} title={TITLES[group]} description="Fill in only what has changed. Your agent reviews every change before it is saved.">
      {open && <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{FIELDS[group].map((field) => <TextField key={field.key} label={field.label} name={field.key} type={field.type} hint={field.hint}
          value={values[field.key] ?? ""} onChange={(value) => setValues({ ...values, [field.key]: value })}
          placeholder={current[field.key] !== undefined && current[field.key] !== null ? String(current[field.key]) : undefined} />)}</div>
        <TextareaField label="Note for your agent (optional)" name="message" rows={2} value={message} onChange={setMessage} />
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={pending}>Send for review</Button></div>
      </form>}
    </Dialog>
  </>;
}

export function WithdrawRequestButton({ id }: { id: string }) {
  const { run, pending } = useMutation();
  return <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(`/api/portal/requests/${id}`, { method: "DELETE", success: "Request withdrawn" })}>Withdraw</Button>;
}

const TYPES = ["image/jpeg", "image/png", "image/webp"];

export function DigitalsUploader({ talentId }: { talentId: string }) {
  const toast = useToast();
  const { run } = useMutation();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function upload(files: File[]) {
    const valid = files.filter((file) => TYPES.includes(file.type) && file.size <= 25 * 1024 * 1024);
    if (valid.length < files.length) toast.error("Only JPG, PNG or WebP photos up to 25 MB can be uploaded.");
    const client = createClient();
    let done = 0;
    for (const file of valid) {
      setBusy(`Uploading ${done + 1} of ${valid.length}…`);
      const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
      const path = `talent/${talentId}/portal/${crypto.randomUUID()}.${extension}`;
      const stored = await client.storage.from("talent-private").upload(path, file, { contentType: file.type });
      if (stored.error) { toast.error(`${file.name} could not be uploaded.`); continue; }
      if (await run("/api/portal/digitals", { body: { storage_path: path, mime_type: file.type, file_size: file.size, original_file_name: file.name }, refresh: false })) done += 1;
    }
    setBusy(null);
    if (done) { toast.success(`${done} digital${done === 1 ? "" : "s"} sent to your agent`); window.location.reload(); }
  }

  return <div className="rounded-xl border border-dashed border-[var(--line)] bg-white p-6 text-center">
    <input ref={input} type="file" accept={TYPES.join(",")} multiple capture="environment" className="sr-only" aria-label="Choose photos" onChange={(event) => { void upload(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
    <p className="text-sm">Natural light, no make-up or filters: a headshot, a full-length shot, and profile shots.</p>
    <Button className="mt-4" icon={<Upload size={14} />} disabled={Boolean(busy)} onClick={() => input.current?.click()}>{busy ?? "Upload digitals"}</Button>
  </div>;
}

export function AvailabilityForm() {
  const { run, pending } = useMutation();
  const [form, setForm] = useState({ kind: "unavailable", start_on: "", end_on: "", note: "" });
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await run("/api/portal/availability", { body: { ...form, end_on: form.end_on || form.start_on }, success: "Dates saved" })) setForm({ kind: "unavailable", start_on: "", end_on: "", note: "" });
  }
  return <form onSubmit={submit} className="grid grid-cols-1 items-end gap-3 rounded-xl border border-[var(--line)] bg-white p-4 sm:grid-cols-[1fr_1fr_1fr_1.4fr_auto]">
    <SelectField label="Type" name="kind" value={form.kind} onChange={(kind) => setForm({ ...form, kind })} options={[{ value: "unavailable", label: "Not available" }, { value: "holiday", label: "Holiday" }, { value: "available", label: "Extra availability" }]} />
    <TextField label="From" name="start_on" type="date" required value={form.start_on} onChange={(start_on) => setForm({ ...form, start_on })} />
    <TextField label="To" name="end_on" type="date" value={form.end_on} onChange={(end_on) => setForm({ ...form, end_on })} />
    <TextField label="Note" name="note" value={form.note} onChange={(note) => setForm({ ...form, note })} />
    <Button type="submit" disabled={pending}>Add</Button>
  </form>;
}

export function RemoveAvailabilityButton({ id }: { id: string }) {
  const { run, pending } = useMutation();
  return <button type="button" aria-label="Remove these dates" disabled={pending} onClick={() => run(`/api/portal/availability/${id}`, { method: "DELETE", success: "Removed" })} className="rounded p-1.5 text-[var(--muted)] hover:bg-[#efefeb] hover:text-[#a9593d]"><Trash2 size={14} /></button>;
}
