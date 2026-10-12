"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Eye, History, Plus, Rocket, Save, Trash2, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { CheckboxField, SelectField, TextareaField, TextField } from "@/components/ui/Field";
import { Card } from "@/components/ui/PageHeader";
import { formatDateTime } from "@/lib/format";
import { useMutation } from "@/lib/use-mutation";
import { BLOCK_DEFAULTS, BLOCK_LABELS, type BlockType } from "../blocks";
import { MediaField } from "./MediaPicker";

type Data = Record<string, unknown>;
type EditableSection = { id: string; type: BlockType; data: Data };
type Field = { key: string; label: string; kind: "text" | "textarea" | "markdown" | "code" | "select" | "checkbox" | "media" | "number" | "board"; options?: { value: string; label: string }[]; hint?: string };

const THEME = [{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }];
const FIELDS: Record<BlockType, Field[]> = {
  hero: [
    { key: "eyebrow", label: "Small line above", kind: "text" }, { key: "heading", label: "Heading", kind: "text" },
    { key: "text", label: "Text", kind: "textarea" }, { key: "image_path", label: "Background image", kind: "media" },
    { key: "cta_label", label: "Button label", kind: "text" }, { key: "cta_href", label: "Button link", kind: "text", hint: "/models, /join, or an https:// link" },
    { key: "theme", label: "Style", kind: "select", options: THEME },
  ],
  rich_text: [
    { key: "heading", label: "Heading", kind: "text" },
    { key: "body", label: "Text", kind: "markdown", hint: "Blank line = new paragraph. ## Heading, - list item, **bold**, _italic_, [link text](/models)." },
  ],
  image: [
    { key: "image_path", label: "Image", kind: "media" }, { key: "alt", label: "Alt text", kind: "text", hint: "Describe the image for people using screen readers." },
    { key: "caption", label: "Caption", kind: "text" },
    { key: "width", label: "Width", kind: "select", options: [{ value: "normal", label: "Text width" }, { value: "wide", label: "Wide" }, { value: "full", label: "Full screen width" }] },
  ],
  video: [{ key: "url", label: "YouTube or Vimeo link", kind: "text" }, { key: "title", label: "Title", kind: "text" }],
  cta: [
    { key: "heading", label: "Heading", kind: "text" }, { key: "text", label: "Text", kind: "textarea" },
    { key: "label", label: "Button label", kind: "text" }, { key: "href", label: "Button link", kind: "text", hint: "/models, /join, mailto:…, or an https:// link" },
    { key: "theme", label: "Style", kind: "select", options: THEME },
  ],
  talent_grid: [
    { key: "heading", label: "Heading", kind: "text" }, { key: "board", label: "Board", kind: "board", hint: "Leave empty for the whole roster. Newly published talent appear automatically." },
    { key: "limit", label: "Number of talent", kind: "number" },
    { key: "sort", label: "Order", kind: "select", options: [{ value: "featured", label: "Featured first" }, { value: "name", label: "Name A–Z" }, { value: "newest", label: "Recently updated" }] },
    { key: "featured_only", label: "Featured talent only", kind: "checkbox" }, { key: "show_link", label: "Show a “View all” link", kind: "checkbox" },
  ],
  board_grid: [{ key: "heading", label: "Heading", kind: "text" }, { key: "parent", label: "Show boards inside", kind: "board", hint: "Leave empty for the top-level boards." }],
  contact: [{ key: "heading", label: "Heading", kind: "text" }, { key: "text", label: "Text", kind: "textarea" }],
  html: [
    { key: "html", label: "HTML", kind: "code", hint: "Scripts, iframes, forms and event handlers are removed when you save." },
    { key: "css", label: "CSS (optional)", kind: "code", hint: "Applies to this block only. @import, external url() and position: fixed are removed." },
  ],
};

export type EditorProps = {
  page: { id: string; slug: string; title: string; seo_title: string | null; meta_description: string | null; og_image_path: string | null; noindex: boolean; sections: unknown; status: "draft" | "published" | "archived"; published_at: string | null; has_unpublished_changes: boolean; updated_at: string };
  revisions: { id: string; version: number; title: string; published_at: string }[];
  boards: { path: string; label: string }[];
  canPublish: boolean;
};

const newId = () => Math.random().toString(36).slice(2, 10);

export function PageEditor({ page, revisions, boards, canPublish }: EditorProps) {
  const router = useRouter();
  const { run, pending } = useMutation();
  const initial = useMemo(() => ({
    title: page.title, slug: page.slug, seo_title: page.seo_title ?? "", meta_description: page.meta_description ?? "", og_image_path: page.og_image_path, noindex: page.noindex,
    sections: (Array.isArray(page.sections) ? page.sections : []) as EditableSection[],
  }), [page]);
  const [meta, setMeta] = useState({ title: initial.title, slug: initial.slug, seo_title: initial.seo_title, meta_description: initial.meta_description, og_image_path: initial.og_image_path, noindex: initial.noindex });
  const [sections, setSections] = useState<EditableSection[]>(initial.sections);
  const [open, setOpen] = useState<string | null>(initial.sections[0]?.id ?? null);
  const [adding, setAdding] = useState(false);
  const [saved, setSaved] = useState(JSON.stringify({ ...meta, sections }));
  const dirty = JSON.stringify({ ...meta, sections }) !== saved;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const update = (id: string, key: string, value: unknown) => setSections((list) => list.map((section) => section.id === id ? { ...section, data: { ...section.data, [key]: value } } : section));
  const move = (index: number, delta: number) => setSections((list) => {
    const next = [...list];
    const target = index + delta;
    if (target < 0 || target >= next.length) return list;
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
  const add = (type: BlockType) => {
    const section = { id: `${type.replace("_", "")}-${newId()}`, type, data: { ...BLOCK_DEFAULTS[type] } as Data };
    setSections((list) => [...list, section]);
    setOpen(section.id);
    setAdding(false);
  };

  async function save() {
    const body = { ...meta, og_image_path: meta.og_image_path ?? "", sections };
    const result = await run(`/api/dashboard/website/pages/${page.id}`, { method: "PATCH", body, success: "Draft saved" });
    if (result) setSaved(JSON.stringify({ ...meta, sections }));
    return Boolean(result);
  }
  async function publish() {
    if (dirty && !(await save())) return;
    await run(`/api/dashboard/website/pages/${page.id}/publish`, { success: "Published — the page is live" });
  }
  const unpublish = (archive: boolean) => run(`/api/dashboard/website/pages/${page.id}/unpublish`, { body: { archive }, success: archive ? "Page archived" : page.status === "archived" ? "Page restored as a draft" : "Page taken offline" });
  async function remove() {
    if (!window.confirm(`Delete “${page.title}” permanently? Its published versions are deleted too.`)) return;
    if (await run(`/api/dashboard/website/pages/${page.id}`, { method: "DELETE", success: "Page deleted", refresh: false })) router.push("/dashboard/website");
  }
  async function restore(revision: EditorProps["revisions"][number]) {
    if (dirty && !window.confirm("You have unsaved changes. Replace them with this version?")) return;
    if (await run(`/api/dashboard/website/revisions/${revision.id}/restore`, { success: `Version ${revision.version} restored to the draft. Publish to make it live.` })) window.location.reload();
  }

  const live = page.status === "published";
  const boardOptions = boards.map((board) => ({ value: board.path, label: board.label }));

  return <div className="space-y-6">
    <div className="sticky top-16 z-10 -mx-4 flex flex-wrap items-center gap-2 border-b border-[#e7e7e3] bg-[#f7f7f5]/95 px-4 py-3 backdrop-blur sm:-mx-8 sm:px-8">
      {live ? <Badge tone="public">Live</Badge> : page.status === "archived" ? <Badge tone="archived">Archived</Badge> : <Badge tone="draft">Draft</Badge>}
      {live && (page.has_unpublished_changes || dirty) && <Badge tone="review">Unpublished changes</Badge>}
      {dirty && <span className="text-xs text-[#94692c]">Not saved</span>}
      <span className="ml-auto flex flex-wrap gap-2">
        <Link href={`/preview/page/${page.id}`} target="_blank" className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[10px] font-800 uppercase tracking-[.12em] text-[#5f615b] hover:bg-[#efefeb]" onClick={(event) => { if (dirty && !window.confirm("Preview shows the last saved draft. Continue without saving?")) event.preventDefault(); }}><Eye size={13} aria-hidden />Preview</Link>
        {live && <a href={`/${page.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-md px-3 py-2 text-[10px] font-800 uppercase tracking-[.12em] text-[#5f615b] hover:bg-[#efefeb]">View live ↗</a>}
        <Button size="sm" variant="secondary" icon={<Save size={13} />} disabled={pending || !dirty} onClick={save}>Save draft</Button>
        {canPublish && page.status !== "archived" && <Button size="sm" icon={<Rocket size={13} />} disabled={pending || (live && !dirty && !page.has_unpublished_changes)} onClick={publish}>{live ? "Publish changes" : "Publish"}</Button>}
      </span>
    </div>

    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-4">
        <Card title="Page">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField label="Title" name="title" required value={meta.title} onChange={(value) => setMeta({ ...meta, title: value })} />
            <TextField label="Address" name="slug" required value={meta.slug} onChange={(value) => setMeta({ ...meta, slug: value.toLowerCase().replace(/\s+/g, "-") })} hint={`Shown at /${meta.slug || "…"}. Changing it breaks old links; add a redirect.`} />
          </div>
        </Card>

        <div className="flex items-center justify-between"><h2 className="text-sm font-800">Sections</h2><Button size="sm" variant="secondary" icon={<Plus size={13} />} onClick={() => setAdding(true)}>Add section</Button></div>
        {sections.length === 0 && <p className="rounded-xl border border-dashed border-[#dcdcd6] bg-white px-6 py-10 text-center text-sm text-[#6b6d66]">This page has no sections yet.</p>}
        <ol className="space-y-3">{sections.map((section, index) => {
          const expanded = open === section.id;
          const summary = String(section.data.heading ?? section.data.alt ?? section.data.url ?? "").slice(0, 60);
          return <li key={section.id} className="rounded-xl border border-[#e7e7e3] bg-white">
            <div className="flex items-center gap-2 px-4 py-3">
              <button type="button" onClick={() => setOpen(expanded ? null : section.id)} aria-expanded={expanded} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                {expanded ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}
                <span className="text-[10px] font-800 uppercase tracking-[.14em] text-[#6b6d66]">{BLOCK_LABELS[section.type].label}</span>
                <span className="truncate text-sm">{summary}</span>
              </button>
              <IconButton label="Move up" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={13} /></IconButton>
              <IconButton label="Move down" disabled={index === sections.length - 1} onClick={() => move(index, 1)}><ArrowDown size={13} /></IconButton>
              <IconButton label="Delete section" onClick={() => window.confirm("Remove this section?") && setSections((list) => list.filter((item) => item.id !== section.id))}><Trash2 size={13} /></IconButton>
            </div>
            {expanded && <div className="grid grid-cols-1 gap-4 border-t border-[#efefeb] p-4 sm:grid-cols-2">{FIELDS[section.type].map((field) => {
              const value = section.data[field.key];
              const wide = ["textarea", "markdown", "code", "media"].includes(field.kind) ? "sm:col-span-2" : "";
              const name = `${section.id}-${field.key}`;
              switch (field.kind) {
                case "media": return <div key={field.key} className={wide}><MediaField label={field.label} value={value as string | undefined} onChange={(path) => update(section.id, field.key, path ?? "")} hint={field.hint} /></div>;
                case "select": return <SelectField key={field.key} className={wide} label={field.label} name={name} value={String(value ?? field.options?.[0]?.value ?? "")} onChange={(next) => update(section.id, field.key, next)} options={field.options ?? []} />;
                case "board": return <SelectField key={field.key} className={wide} label={field.label} name={name} value={String(value ?? "")} onChange={(next) => update(section.id, field.key, next)} options={boardOptions} placeholder="—" hint={field.hint} />;
                case "checkbox": return <CheckboxField key={field.key} className={`${wide} self-end`} label={field.label} name={name} checked={Boolean(value)} onChange={(next) => update(section.id, field.key, next)} />;
                case "number": return <TextField key={field.key} className={wide} label={field.label} name={name} type="number" min={1} max={24} value={String(value ?? "")} onChange={(next) => update(section.id, field.key, next === "" ? "" : Number(next))} />;
                case "textarea": return <TextareaField key={field.key} className={wide} label={field.label} name={name} rows={3} value={String(value ?? "")} onChange={(next) => update(section.id, field.key, next)} />;
                case "markdown": return <TextareaField key={field.key} className={wide} label={field.label} name={name} rows={12} value={String(value ?? "")} onChange={(next) => update(section.id, field.key, next)} hint={field.hint} />;
                case "code": return <label key={field.key} className={`${wide} block text-[10px] font-800 uppercase tracking-[.14em] text-[#6f716b]`}>{field.label}
                  <textarea rows={10} spellCheck={false} value={String(value ?? "")} onChange={(event) => update(section.id, field.key, event.target.value)} className="mt-2 w-full rounded-md border border-[#dcdcd6] bg-[#fbfbfa] px-3 py-2.5 font-mono text-xs normal-case tracking-normal text-[#20211f] outline-none focus:border-[#a4502f]" />
                  {field.hint && <span className="mt-1.5 block text-[11px] font-400 normal-case tracking-normal text-[#6b6d66]">{field.hint}</span>}</label>;
                default: return <TextField key={field.key} className={wide} label={field.label} name={name} value={String(value ?? "")} onChange={(next) => update(section.id, field.key, next)} hint={field.hint} />;
              }
            })}</div>}
          </li>;
        })}</ol>
      </div>

      <aside className="min-w-0 space-y-4">
        <Card title="Search & sharing">
          <div className="space-y-4">
            <TextField label="SEO title" name="seo_title" value={meta.seo_title} onChange={(value) => setMeta({ ...meta, seo_title: value })} hint="Defaults to the page title." />
            <TextareaField label="Meta description" name="meta_description" rows={3} value={meta.meta_description} onChange={(value) => setMeta({ ...meta, meta_description: value })} hint={`${meta.meta_description.length}/320 · shown by search engines.`} />
            <MediaField label="Social sharing image" value={meta.og_image_path} onChange={(path) => setMeta({ ...meta, og_image_path: path })} />
            <CheckboxField label="Hide from search engines" name="noindex" checked={meta.noindex} onChange={(checked) => setMeta({ ...meta, noindex: checked })} />
          </div>
        </Card>
        <Card title="Published versions" description="Restore a version into the draft, then publish it.">
          {revisions.length ? <ul className="space-y-2 text-sm">{revisions.map((revision) => <li key={revision.id} className="flex items-center justify-between gap-3">
            <span className="min-w-0"><span className="font-700">v{revision.version}</span> <span className="text-xs text-[#6b6d66]">{formatDateTime(revision.published_at)}</span></span>
            <Button size="sm" variant="ghost" icon={<History size={13} />} disabled={pending} onClick={() => restore(revision)}>Restore</Button>
          </li>)}</ul> : <p className="text-xs text-[#6b6d66]">Not published yet.</p>}
        </Card>
        {canPublish && <Card title="Status">
          <div className="flex flex-wrap gap-2">
            {live && <Button size="sm" variant="secondary" icon={<Undo2 size={13} />} disabled={pending} onClick={() => window.confirm("Take this page offline? Visitors will get a “not found” page.") && unpublish(false)}>Unpublish</Button>}
            {page.status !== "archived" ? <Button size="sm" variant="ghost" disabled={pending} onClick={() => window.confirm("Archive this page? It goes offline and leaves the page list.") && unpublish(true)}>Archive</Button>
              : <Button size="sm" variant="secondary" disabled={pending} onClick={() => unpublish(false)}>Restore as draft</Button>}
            {!live && <Button size="sm" variant="danger" icon={<Trash2 size={13} />} disabled={pending} onClick={remove}>Delete</Button>}
          </div>
          {page.published_at && <p className="mt-3 text-xs text-[#6b6d66]">Last published {formatDateTime(page.published_at)}</p>}
        </Card>}
      </aside>
    </div>

    <Dialog open={adding} onClose={() => setAdding(false)} title="Add a section" wide>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">{(Object.keys(BLOCK_LABELS) as BlockType[]).map((type) => <li key={type}>
        <button type="button" onClick={() => add(type)} className="w-full rounded-lg border border-[#e7e7e3] px-4 py-3 text-left hover:border-[#20211f]">
          <span className="block text-sm font-800">{BLOCK_LABELS[type].label}</span><span className="mt-0.5 block text-xs text-[#6b6d66]">{BLOCK_LABELS[type].hint}</span>
        </button>
      </li>)}</ul>
    </Dialog>
  </div>;
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled}
    className="rounded border border-[#e7e7e3] p-1.5 text-[#5f615b] hover:border-[#20211f] hover:text-[#20211f] disabled:cursor-not-allowed disabled:opacity-40">{children}</button>;
}
