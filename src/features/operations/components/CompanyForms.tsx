"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { CheckboxField, SelectField, TextareaField, TextField } from "@/components/ui/Field";
import { Card } from "@/components/ui/PageHeader";
import { readForm } from "@/lib/read-form";
import { useMutation } from "@/lib/use-mutation";
import { COMPANY_KINDS, LABELS } from "../schemas";

type Company = Record<string, string | boolean | null> & { id?: string; name?: string };
const kinds = COMPANY_KINDS.map((kind) => ({ value: kind, label: LABELS.company[kind] }));

export function CompanyDialog({ company, trigger }: { company?: Company; trigger: "new" | "edit" }) {
  const router = useRouter();
  const { run, pending } = useMutation();
  const [open, setOpen] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = { ...readForm(event.currentTarget), is_active: company ? Boolean(readForm(event.currentTarget).is_active) : true };
    if (company?.id) {
      if (await run(`/api/dashboard/companies/${company.id}`, { method: "PATCH", body, success: "Company saved" })) setOpen(false);
    } else {
      const created = await run<{ id: string }>("/api/dashboard/companies", { body, success: "Company created", refresh: false });
      if (created?.id) router.push(`/dashboard/companies/${created.id}`);
    }
  }

  const value = (key: string) => (typeof company?.[key] === "string" ? company[key] as string : "");
  return <>
    {trigger === "new" ? <Button icon={<Plus size={14} />} onClick={() => setOpen(true)}>New company</Button> : <Button size="sm" variant="secondary" icon={<Pencil size={13} />} onClick={() => setOpen(true)}>Edit</Button>}
    <Dialog open={open} onClose={() => setOpen(false)} title={company ? `Edit ${company.name}` : "New company"} wide>
      {open && <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField label="Name" name="name" required defaultValue={value("name")} />
          <SelectField label="Type" name="kind" defaultValue={value("kind") || "client"} options={kinds} />
          <TextField label="Email" name="email" type="email" defaultValue={value("email")} />
          <TextField label="Billing email" name="billing_email" type="email" defaultValue={value("billing_email")} />
          <TextField label="Phone" name="phone" defaultValue={value("phone")} />
          <TextField label="Website" name="website" defaultValue={value("website")} placeholder="https://" />
          <TextField label="Address" name="address_1" defaultValue={value("address_1")} />
          <TextField label="City" name="city" defaultValue={value("city")} />
          <TextField label="State" name="state" defaultValue={value("state")} />
          <TextField label="Postal code" name="postal_code" defaultValue={value("postal_code")} />
          <TextField label="Country" name="country" defaultValue={value("country")} />
          <TextareaField label="Notes" name="notes" rows={3} className="sm:col-span-2" defaultValue={value("notes")} />
          {company && <CheckboxField label="Active" name="is_active" defaultChecked={company.is_active !== false} hint="Inactive companies are hidden from pickers." />}
        </div>
        <div className="flex justify-end gap-2 border-t border-[#efefeb] pt-4"><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button></div>
      </form>}
    </Dialog>
  </>;
}

export function DeleteCompanyButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const { run, pending } = useMutation();
  return <Button size="sm" variant="danger" icon={<Trash2 size={13} />} disabled={pending}
    onClick={async () => { if (window.confirm(`Delete ${name}? Its contacts are deleted; bookings are kept without a company.`) && await run(`/api/dashboard/companies/${id}`, { method: "DELETE", success: "Company deleted", refresh: false })) router.push("/dashboard/companies"); }}>Delete</Button>;
}

type Contact = { id: string; name: string; title: string | null; email: string | null; phone: string | null; notes: string | null; is_primary: boolean };

export function ContactsPanel({ companyId, contacts, canManage }: { companyId: string; contacts: Contact[]; canManage: boolean }) {
  const { run, pending } = useMutation();
  const [editing, setEditing] = useState<Contact | "new" | null>(null);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = { ...readForm(event.currentTarget), is_primary: Boolean(readForm(event.currentTarget).is_primary) };
    const ok = editing === "new"
      ? await run(`/api/dashboard/companies/${companyId}/contacts`, { body, success: "Contact added" })
      : await run(`/api/dashboard/contacts/${(editing as Contact).id}`, { method: "PATCH", body, success: "Contact saved" });
    if (ok) setEditing(null);
  }
  const current = editing && editing !== "new" ? editing : null;
  return <Card title="Contacts" actions={canManage ? <Button size="sm" variant="secondary" icon={<Plus size={13} />} onClick={() => setEditing("new")}>Add contact</Button> : undefined}>
    {contacts.length ? <ul className="divide-y divide-[#f3f3f0] text-sm">{contacts.map((contact) => <li key={contact.id} className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="font-700">{contact.name}{contact.is_primary && <Star size={12} className="ml-1.5 inline text-[#a4502f]" aria-label="Primary contact" />}</p>
        <p className="text-xs text-[#6b6d66]">{[contact.title, contact.email, contact.phone].filter(Boolean).join(" · ")}</p>
      </div>
      {contact.email && <a href={`mailto:${contact.email}`} className="text-xs text-[#5f615b] hover:underline">Email</a>}
      {canManage && <>
        <Button size="sm" variant="ghost" onClick={() => setEditing(contact)}>Edit</Button>
        <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} disabled={pending} onClick={() => window.confirm(`Remove ${contact.name}?`) && run(`/api/dashboard/contacts/${contact.id}`, { method: "DELETE", success: "Contact removed" })}><span className="sr-only">Remove</span></Button>
      </>}
    </li>)}</ul> : <p className="text-sm text-[#6b6d66]">No contacts yet.</p>}
    <Dialog open={Boolean(editing)} onClose={() => setEditing(null)} title={current ? `Edit ${current.name}` : "New contact"}>
      {editing && <form onSubmit={submit} className="space-y-4" key={current?.id ?? "new"}>
        <TextField label="Name" name="name" required defaultValue={current?.name} />
        <TextField label="Job title" name="title" defaultValue={current?.title} />
        <TextField label="Email" name="email" type="email" defaultValue={current?.email} />
        <TextField label="Phone" name="phone" defaultValue={current?.phone} />
        <TextareaField label="Notes" name="notes" rows={2} defaultValue={current?.notes} />
        <CheckboxField label="Primary contact" name="is_primary" defaultChecked={current?.is_primary} />
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" disabled={pending}>Save</Button></div>
      </form>}
    </Dialog>
  </Card>;
}
