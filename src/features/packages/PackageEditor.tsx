"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Copy, Link2, Search, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CheckboxField, SelectField, TextareaField, TextField } from "@/components/ui/Field";
import { Card } from "@/components/ui/PageHeader";
import { useToast } from "@/components/ui/Toast";
import { formatDateTime } from "@/lib/format";
import { useMutation } from "@/lib/use-mutation";
import { linkState } from "./share-state";

type Item = { talent_id: string; note: string };
export type PackageData = {
  id: string; title: string; message: string | null; company_id: string | null; contact_id: string | null; show_measurements: boolean;
  shared_at: string | null; expires_at: string | null; revoked_at: string | null; view_count: number; last_viewed_at: string | null; has_link: boolean;
  items: { talent_id: string; note: string | null }[];
};

export function PackageEditor({ pkg, talent, companies, contacts }: {
  pkg: PackageData; talent: { id: string; display_name: string }[]; companies: { id: string; name: string }[]; contacts: { id: string; name: string; company_id: string }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const { run, pending } = useMutation();
  const [title, setTitle] = useState(pkg.title);
  const [message, setMessage] = useState(pkg.message ?? "");
  const [companyId, setCompanyId] = useState(pkg.company_id ?? "");
  const [contactId, setContactId] = useState(pkg.contact_id ?? "");
  const [measurements, setMeasurements] = useState(pkg.show_measurements);
  const [items, setItems] = useState<Item[]>(pkg.items.map((item) => ({ talent_id: item.talent_id, note: item.note ?? "" })));
  const [filter, setFilter] = useState("");
  const [days, setDays] = useState("30");
  const [link, setLink] = useState<string | null>(null);

  const names = new Map(talent.map((item) => [item.id, item.display_name]));
  const matches = filter.trim() ? talent.filter((item) => item.display_name.toLowerCase().includes(filter.trim().toLowerCase()) && !items.some((existing) => existing.talent_id === item.id)).slice(0, 8) : [];
  const move = (index: number, delta: number) => setItems((list) => {
    const next = [...list];
    const target = index + delta;
    if (target < 0 || target >= next.length) return list;
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
  const state = linkState(pkg);

  const save = () => run(`/api/dashboard/packages/${pkg.id}`, { method: "PUT", body: { title, message, company_id: companyId, contact_id: contactId, show_measurements: measurements, items }, success: "Package saved" });
  async function share() {
    if (!(await save())) return;
    const result = await run<{ url: string }>(`/api/dashboard/packages/${pkg.id}/share`, { body: { days: Number(days) }, success: "Link created" });
    if (result?.url) setLink(result.url);
  }
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); toast.success("Link copied"); } catch { toast.error("Copy failed; select the link and copy it manually."); }
  }
  async function remove() {
    if (!window.confirm("Delete this package? Its link stops working.")) return;
    if (await run(`/api/dashboard/packages/${pkg.id}`, { method: "DELETE", success: "Package deleted", refresh: false })) router.push("/dashboard/packages");
  }

  return <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
    <div className="min-w-0 space-y-6">
      <Card title="Package">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField label="Title" name="title" required className="sm:col-span-2" value={title} onChange={setTitle} />
          <SelectField label="Client" name="company_id" value={companyId} onChange={(value) => { setCompanyId(value); setContactId(""); }} options={companies.map((company) => ({ value: company.id, label: company.name }))} placeholder="—" />
          <SelectField label="Contact" name="contact_id" value={contactId} onChange={setContactId} disabled={!companyId} options={contacts.filter((contact) => contact.company_id === companyId).map((contact) => ({ value: contact.id, label: contact.name }))} placeholder="—" />
          <TextareaField label="Message to the client" name="message" rows={3} className="sm:col-span-2" value={message} onChange={setMessage} />
          <CheckboxField label="Show measurements" name="show_measurements" className="sm:col-span-2" checked={measurements} onChange={setMeasurements} hint="Only for talent who allow their measurements to be public." />
        </div>
      </Card>

      <Card title={`Talent (${items.length})`} description="Only photos approved for public use are shown to the client.">
        <div className="relative mb-4 max-w-md">
          <label className="flex items-center gap-2 rounded-md border border-[#dcdcd6] bg-white px-3 py-2"><Search size={14} className="text-[#6b6d66]" aria-hidden /><span className="sr-only">Add talent</span>
            <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Add talent by name" className="w-full text-sm outline-none" /></label>
          {matches.length > 0 && <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-[#e7e7e3] bg-white shadow-lg">{matches.map((item) => <li key={item.id}>
            <button type="button" onClick={() => { setItems([...items, { talent_id: item.id, note: "" }]); setFilter(""); }} className="block w-full px-3 py-2 text-left text-sm hover:bg-[#f7f7f5]">{item.display_name}</button>
          </li>)}</ul>}
        </div>
        {items.length ? <ol className="space-y-2">{items.map((item, index) => <li key={item.talent_id} className="grid grid-cols-1 items-center gap-2 rounded-lg border border-[#efefeb] p-3 sm:grid-cols-[1fr_1.4fr_auto]">
          <span className="text-sm font-700">{index + 1}. {names.get(item.talent_id) ?? "Talent"}</span>
          <input aria-label={`Note for ${names.get(item.talent_id)}`} value={item.note} maxLength={600} onChange={(event) => setItems(items.map((row, i) => i === index ? { ...row, note: event.target.value } : row))} placeholder="Optional note for the client" className="w-full rounded-md border border-[#dcdcd6] px-3 py-2 text-sm outline-none focus:border-[#a4502f]" />
          <span className="flex gap-1">
            <IconButton label="Move up" onClick={() => move(index, -1)}><ArrowUp size={13} /></IconButton>
            <IconButton label="Move down" onClick={() => move(index, 1)}><ArrowDown size={13} /></IconButton>
            <IconButton label="Remove" onClick={() => setItems(items.filter((_, i) => i !== index))}><X size={13} /></IconButton>
          </span>
        </li>)}</ol> : <p className="text-sm text-[#6b6d66]">Add the talent you want to present.</p>}
      </Card>
      <div className="flex justify-between gap-2"><Button variant="danger" icon={<Trash2 size={14} />} onClick={remove} disabled={pending}>Delete</Button><Button onClick={save} disabled={pending || !title.trim()}>{pending ? "Saving…" : "Save package"}</Button></div>
    </div>

    <aside className="min-w-0 space-y-4">
      <Card title="Share with the client" description="A private link that expires. Anyone with the link can view the package.">
        <div className="space-y-3 text-sm">
          <p>{state === "live" ? <Badge tone="public">Link active</Badge> : state === "expired" ? <Badge tone="inactive">Link expired</Badge> : state === "revoked" ? <Badge tone="internal">Link revoked</Badge> : <Badge tone="draft">Not shared</Badge>}</p>
          {state === "live" && pkg.expires_at && <p className="text-xs text-[#6b6d66]">Expires {formatDateTime(pkg.expires_at)}</p>}
          {pkg.view_count > 0 && <p className="text-xs text-[#6b6d66]">Viewed {pkg.view_count} time{pkg.view_count === 1 ? "" : "s"}{pkg.last_viewed_at ? `, last ${formatDateTime(pkg.last_viewed_at)}` : ""}</p>}
          {link && <div className="rounded-md border border-[#b7cdb9] bg-[#f3f8f3] p-3">
            <p className="text-xs font-700 text-[#3f6b45]">Copy this link now. For security it is not shown again.</p>
            <input readOnly value={link} aria-label="Share link" onFocus={(event) => event.target.select()} className="mt-2 w-full rounded border border-[#dcdcd6] bg-white px-2 py-1.5 font-mono text-[11px]" />
            <Button size="sm" variant="secondary" className="mt-2" icon={<Copy size={13} />} onClick={() => copy(link)}>Copy link</Button>
          </div>}
          <div className="flex items-end gap-2">
            <SelectField label="Valid for" name="days" value={days} onChange={setDays} options={[{ value: "7", label: "7 days" }, { value: "14", label: "14 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }]} />
            <Button icon={<Link2 size={14} />} disabled={pending || !items.length} onClick={share}>{pkg.has_link ? "New link" : "Create link"}</Button>
          </div>
          {pkg.has_link && <p className="text-[11px] text-[#6b6d66]">Creating a new link stops the old one working.</p>}
          {state === "live" && <Button size="sm" variant="ghost" disabled={pending} onClick={() => window.confirm("Stop this link working now?") && run(`/api/dashboard/packages/${pkg.id}/share`, { method: "DELETE", success: "Link revoked" })}>Revoke link</Button>}
        </div>
      </Card>
    </aside>
  </div>;
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" title={label} aria-label={label} onClick={onClick} className="rounded border border-[#e7e7e3] p-1.5 text-[#5f615b] hover:border-[#20211f] hover:text-[#20211f]">{children}</button>;
}
