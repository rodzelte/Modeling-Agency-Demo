"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { CheckboxField, SelectField, TextareaField, TextField } from "@/components/ui/Field";
import { Card } from "@/components/ui/PageHeader";
import { formatDate } from "@/lib/format";
import { useMutation } from "@/lib/use-mutation";
import { MediaField, MediaGrid, UploadButton, useMediaLibrary } from "./MediaPicker";

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------
type PageRow = { id: string; slug: string; title: string; status: "draft" | "published" | "archived"; published_at: string | null; has_unpublished_changes: boolean; updated_at: string };

export function PagesPanel({ pages }: { pages: PageRow[] }) {
  const router = useRouter();
  const { run, pending } = useMutation();
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const visible = pages.filter((page) => showArchived || page.status !== "archived");

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await run<{ id: string }>("/api/dashboard/website/pages", { body: { title, slug }, success: "Page created", refresh: false });
    if (result?.id) router.push(`/dashboard/website/pages/${result.id}`);
  }

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <CheckboxField label="Show archived pages" name="archived" checked={showArchived} onChange={setShowArchived} />
      <Button icon={<Plus size={14} />} onClick={() => setCreating(true)}>New page</Button>
    </div>
    <div className="overflow-hidden rounded-xl border border-[#e7e7e3] bg-white">
      {visible.length ? <ul className="divide-y divide-[#f3f3f0]">{visible.map((page) => <li key={page.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
        <Link href={`/dashboard/website/pages/${page.id}`} className="min-w-0 flex-1"><span className="font-700 hover:text-[#a4502f]">{page.title}</span><span className="block text-[11px] text-[#6b6d66]">/{page.slug} · edited {formatDate(page.updated_at)}</span></Link>
        {page.status === "published" ? <Badge tone="public">Live</Badge> : page.status === "archived" ? <Badge tone="archived">Archived</Badge> : <Badge tone="draft">Draft</Badge>}
        {page.status === "published" && page.has_unpublished_changes && <Badge tone="review">Unpublished changes</Badge>}
      </li>)}</ul> : <p className="px-6 py-10 text-center text-sm text-[#6b6d66]">No pages yet.</p>}
    </div>
    <Dialog open={creating} onClose={() => setCreating(false)} title="New page" description="Pages start as private drafts.">
      <form onSubmit={create} className="space-y-4">
        <TextField label="Title" name="title" required value={title} onChange={(value) => { setTitle(value); setSlug(value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")); }} />
        <TextField label="Address" name="slug" required value={slug} onChange={(value) => setSlug(value.toLowerCase())} hint={`The page will be at /${slug || "…"}`} />
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button><Button type="submit" disabled={pending}>Create draft</Button></div>
      </form>
    </Dialog>
  </div>;
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
type NavRow = { id?: string; key: string; location: "header" | "footer"; label: string; href: string; is_visible: boolean };

export function NavigationPanel({ items, pages }: { items: Omit<NavRow, "key">[]; pages: { slug: string; title: string; status: string }[] }) {
  const { run, pending } = useMutation();
  const [rows, setRows] = useState<NavRow[]>(items.map((item) => ({ ...item, key: item.id ?? crypto.randomUUID() })));
  const set = (key: string, patch: Partial<NavRow>) => setRows((list) => list.map((row) => row.key === key ? { ...row, ...patch } : row));
  const move = (key: string, delta: number) => setRows((list) => {
    const index = list.findIndex((row) => row.key === key);
    const next = [...list];
    const target = index + delta;
    if (target < 0 || target >= next.length) return list;
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
  const save = () => run("/api/dashboard/website/navigation", { method: "PUT", body: { items: rows.map(({ key: _key, ...row }) => { void _key; return row; }) }, success: "Menu saved" });
  const live = new Set(pages.filter((page) => page.status === "published").map((page) => `/${page.slug}`));

  const section = (location: "header" | "footer") => <Card key={location} title={location === "header" ? "Header menu" : "Footer links"}
    description={location === "header" ? "Shown after the board links. About, Join us and Contact are always included." : "Shown at the bottom of every public page."}
    actions={<Button size="sm" variant="secondary" icon={<Plus size={13} />} onClick={() => setRows((list) => [...list, { key: crypto.randomUUID(), location, label: "", href: "/", is_visible: true }])}>Add link</Button>}>
    {rows.some((row) => row.location === location) ? <ul className="space-y-3">{rows.filter((row) => row.location === location).map((row) => <li key={row.key} className="grid grid-cols-1 items-end gap-3 rounded-lg border border-[#efefeb] p-3 sm:grid-cols-[1fr_1.4fr_auto]">
      <TextField label="Label" name={`label-${row.key}`} value={row.label} onChange={(value) => set(row.key, { label: value })} />
      <TextField label="Link" name={`href-${row.key}`} value={row.href} onChange={(value) => set(row.key, { href: value })}
        hint={row.href.startsWith("/") && !/^\/($|#|models|join)/.test(row.href) && !live.has(row.href.split(/[?#]/)[0]) ? "Hidden until that page is published." : undefined} />
      <div className="flex items-center gap-1.5 pb-1">
        <label className="mr-2 flex items-center gap-1.5 text-[11px] text-[#5f615b]"><input type="checkbox" checked={row.is_visible} onChange={(event) => set(row.key, { is_visible: event.target.checked })} className="accent-[#20211f]" />Visible</label>
        <SmallButton label="Move up" onClick={() => move(row.key, -1)}><ArrowUp size={13} /></SmallButton>
        <SmallButton label="Move down" onClick={() => move(row.key, 1)}><ArrowDown size={13} /></SmallButton>
        <SmallButton label="Remove link" onClick={() => setRows((list) => list.filter((item) => item.key !== row.key))}><Trash2 size={13} /></SmallButton>
      </div>
    </li>)}</ul> : <p className="text-sm text-[#6b6d66]">No links.</p>}
  </Card>;

  return <div className="space-y-4">
    {section("header")}{section("footer")}
    <div className="flex justify-end"><Button disabled={pending} onClick={save}>{pending ? "Saving…" : "Save menus"}</Button></div>
  </div>;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
export type SettingsValue = {
  contact_email: string; contact_phone: string | null; instagram_url: string | null; location_line: string | null; contact_heading: string;
  home_hero: { eyebrow?: string; headline?: string; text?: string | null; image_path?: string | null };
  home_about: { eyebrow?: string; headline?: string; text?: string | null; image_path?: string | null };
};

export function SettingsPanel({ settings }: { settings: SettingsValue }) {
  const { run, pending } = useMutation();
  const [value, setValue] = useState(settings);
  const hero = (patch: Partial<SettingsValue["home_hero"]>) => setValue({ ...value, home_hero: { ...value.home_hero, ...patch } });
  const about = (patch: Partial<SettingsValue["home_about"]>) => setValue({ ...value, home_about: { ...value.home_about, ...patch } });
  const save = () => run("/api/dashboard/website/settings", {
    method: "PUT",
    body: {
      ...value, contact_phone: value.contact_phone ?? "", instagram_url: value.instagram_url ?? "", location_line: value.location_line ?? "",
      home_hero: { ...value.home_hero, text: value.home_hero.text ?? "", image_path: value.home_hero.image_path ?? "" },
      home_about: { ...value.home_about, text: value.home_about.text ?? "", image_path: value.home_about.image_path ?? "" },
    },
    success: "Settings saved — the website is updated",
  });

  return <div className="space-y-4">
    <Card title="Contact details" description="Used on the home page, the Contact block, and the footer.">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField label="Contact email" name="contact_email" type="email" required value={value.contact_email} onChange={(next) => setValue({ ...value, contact_email: next })} />
        <TextField label="Phone" name="contact_phone" value={value.contact_phone ?? ""} onChange={(next) => setValue({ ...value, contact_phone: next })} />
        <TextField label="Instagram link" name="instagram_url" value={value.instagram_url ?? ""} onChange={(next) => setValue({ ...value, instagram_url: next })} placeholder="https://instagram.com/…" />
        <TextField label="Location line" name="location_line" value={value.location_line ?? ""} onChange={(next) => setValue({ ...value, location_line: next })} />
        <TextareaField label="Contact heading (home page)" name="contact_heading" rows={2} className="sm:col-span-2" value={value.contact_heading} onChange={(next) => setValue({ ...value, contact_heading: next })} hint="A second line is shown in italics." />
      </div>
    </Card>
    <Card title="Home page — top" description="Until an image is chosen, the first published talent photo is used.">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField label="Small line above" name="hero_eyebrow" value={value.home_hero.eyebrow ?? ""} onChange={(next) => hero({ eyebrow: next })} />
        <TextareaField label="Headline" name="hero_headline" rows={2} value={value.home_hero.headline ?? ""} onChange={(next) => hero({ headline: next })} hint="A second line is shown in italics." />
        <TextareaField label="Text (optional)" name="hero_text" rows={2} className="sm:col-span-2" value={value.home_hero.text ?? ""} onChange={(next) => hero({ text: next })} />
        <div className="sm:col-span-2"><MediaField label="Background image" value={value.home_hero.image_path} onChange={(path) => hero({ image_path: path })} /></div>
      </div>
    </Card>
    <Card title="Home page — about">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField label="Small line above" name="about_eyebrow" value={value.home_about.eyebrow ?? ""} onChange={(next) => about({ eyebrow: next })} />
        <TextareaField label="Headline" name="about_headline" rows={2} value={value.home_about.headline ?? ""} onChange={(next) => about({ headline: next })} />
        <TextareaField label="Text" name="about_text" rows={3} className="sm:col-span-2" value={value.home_about.text ?? ""} onChange={(next) => about({ text: next })} />
        <div className="sm:col-span-2"><MediaField label="Image" value={value.home_about.image_path} onChange={(path) => about({ image_path: path })} /></div>
      </div>
    </Card>
    <div className="flex justify-end"><Button disabled={pending} onClick={save}>{pending ? "Saving…" : "Save settings"}</Button></div>
  </div>;
}

// ---------------------------------------------------------------------------
// Redirects
// ---------------------------------------------------------------------------
type RedirectRow = { id: string; from_path: string; to_path: string; permanent: boolean; is_active: boolean; hits: number };

export function RedirectsPanel({ redirects }: { redirects: RedirectRow[] }) {
  const { run, pending } = useMutation();
  const [form, setForm] = useState({ from_path: "", to_path: "", permanent: true });
  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await run("/api/dashboard/website/redirects", { body: form, success: "Redirect added" })) setForm({ from_path: "", to_path: "", permanent: true });
  }
  return <div className="space-y-4">
    <Card title="Add a redirect" description="Send visitors from an old website address to its new page, so links and search rankings keep working.">
      <form onSubmit={add} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_1fr_auto_auto]">
        <TextField label="Old address" name="from_path" required value={form.from_path} onChange={(value) => setForm({ ...form, from_path: value })} placeholder="/fashion-women" />
        <TextField label="New address" name="to_path" required value={form.to_path} onChange={(value) => setForm({ ...form, to_path: value })} placeholder="/models/fashion/women" />
        <SelectField label="Type" name="permanent" value={form.permanent ? "1" : "0"} onChange={(value) => setForm({ ...form, permanent: value === "1" })} options={[{ value: "1", label: "Permanent (301)" }, { value: "0", label: "Temporary (307)" }]} />
        <Button type="submit" disabled={pending}>Add</Button>
      </form>
    </Card>
    <div className="overflow-x-auto rounded-xl border border-[#e7e7e3] bg-white">
      {redirects.length ? <table className="w-full min-w-[560px] text-left text-sm"><thead><tr className="border-b border-[#efefeb] text-[9px] font-800 uppercase tracking-[.14em] text-[#6b6d66]"><th className="px-4 py-3">From</th><th className="px-4 py-3">To</th><th className="px-4 py-3">Visits</th><th className="px-4 py-3"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{redirects.map((row) => <tr key={row.id} className={`border-b border-[#f3f3f0] last:border-0 ${row.is_active ? "" : "opacity-50"}`}>
          <td className="px-4 py-3 font-mono text-xs">{row.from_path}</td>
          <td className="px-4 py-3 font-mono text-xs">{row.to_path} <span className="font-sans text-[10px] text-[#6b6d66]">{row.permanent ? "301" : "307"}</span></td>
          <td className="px-4 py-3 text-xs tabular-nums">{row.hits}</td>
          <td className="px-4 py-3 text-right"><span className="inline-flex gap-1.5">
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(`/api/dashboard/website/redirects/${row.id}`, { method: "PATCH", body: { is_active: !row.is_active }, success: row.is_active ? "Redirect paused" : "Redirect active" })}>{row.is_active ? "Pause" : "Resume"}</Button>
            <SmallButton label="Delete redirect" onClick={() => window.confirm("Delete this redirect?") && run(`/api/dashboard/website/redirects/${row.id}`, { method: "DELETE", success: "Redirect deleted" })}><Trash2 size={13} /></SmallButton>
          </span></td>
        </tr>)}</tbody></table> : <p className="px-6 py-10 text-center text-sm text-[#6b6d66]">No redirects yet.</p>}
    </div>
  </div>;
}

// ---------------------------------------------------------------------------
// Media library
// ---------------------------------------------------------------------------
export function MediaPanel() {
  const library = useMediaLibrary();
  const { load } = library;
  useEffect(() => { void load(); }, [load]);
  return <Card title="Media library" description="Images for website pages and the home page. They become public when used on a published page." actions={<UploadButton busy={library.busy} onFiles={library.upload} />}>
    {library.items ? <MediaGrid items={library.items} onRemove={library.remove} /> : <p className="py-8 text-center text-sm text-[#6b6d66]">Loading…</p>}
  </Card>;
}

function SmallButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" title={label} aria-label={label} onClick={onClick} className="rounded border border-[#e7e7e3] p-1.5 text-[#5f615b] hover:border-[#20211f] hover:text-[#20211f]">{children}</button>;
}

export { MediaField };
