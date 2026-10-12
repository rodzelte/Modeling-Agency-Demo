"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CheckboxField, TextField, TextareaField } from "@/components/ui/Field";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/States";
import { Thumb } from "@/components/ui/Thumb";
import { readForm } from "@/lib/read-form";
import { useMutation } from "@/lib/use-mutation";
import type { MediaCollection, MediaPhoto } from "./types";

const copy = {
  portfolio: { title: "Portfolios", singular: "portfolio", description: "Named books such as Commercial or Fashion. A photo can appear in several. Public portfolios show on the website when \"Show portfolios\" is on; only public images appear." },
  book: { title: "Digital books", singular: "digital book", description: "Create a book, select uploaded images, arrange them, and optionally publish it." },
};

export function CollectionManager({ talentId, kind, collections, photos, canManage }: { talentId: string; kind: "portfolio" | "book"; collections: MediaCollection[]; photos: MediaPhoto[]; canManage: boolean }) {
  const { run, pending } = useMutation();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<MediaCollection | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const text = copy[kind];
  const base = `/api/dashboard/talents/${talentId}/media/collections`;
  const photoById = new Map(photos.map((photo) => [photo.id, photo]));

  function open(collection: MediaCollection) {
    setEditing(collection);
    setSelection(collection.photo_ids.filter((id) => photoById.has(id)));
  }

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const created = await run<{ id: string }>(base, { body: { kind, ...readForm(event.currentTarget) }, success: `${text.singular[0].toUpperCase()}${text.singular.slice(1)} created` });
    if (created) setCreating(false);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const saved = await run(`${base}/${editing.id}`, { method: "PATCH", body: { kind, ...readForm(event.currentTarget), photo_ids: selection }, success: "Saved" });
    if (saved) setEditing(null);
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= selection.length) return;
    const next = [...selection];
    [next[index], next[target]] = [next[target], next[index]];
    setSelection(next);
  }

  return <section className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h3 className="text-sm font-800">{text.title}</h3><p className="mt-1 max-w-2xl text-xs text-[#6b6d66]">{text.description}</p></div>
      {canManage && <Button size="sm" variant="secondary" icon={<Plus size={13} />} onClick={() => setCreating(true)}>New {text.singular}</Button>}
    </div>

    {collections.length ? <ul className="grid gap-3 sm:grid-cols-2">{collections.map((collection) => <li key={collection.id} className="rounded-lg border border-[#e7e7e3] p-4">
      <div className="flex items-start justify-between gap-2">
        <div><p className="text-sm font-700">{collection.name}</p><p className="mt-0.5 text-[11px] text-[#6b6d66]">{collection.photo_ids.length} image{collection.photo_ids.length === 1 ? "" : "s"}</p></div>
        <div className="flex gap-1">{collection.is_default && <Badge tone="review">Default</Badge>}{collection.public ? <Badge tone="public">Public</Badge> : <Badge tone="private">Private</Badge>}</div>
      </div>
      <div className="mt-3 flex gap-1.5 overflow-hidden">{collection.photo_ids.slice(0, 6).map((id) => <Thumb key={id} src={photoById.get(id)?.url ?? null} alt="" className="h-14 w-11" />)}</div>
      {canManage && <div className="mt-3 flex gap-2">
        <Button size="sm" variant="secondary" onClick={() => open(collection)}>Edit</Button>
        <Button size="sm" variant="ghost" icon={<Trash2 size={12} />} disabled={pending} onClick={() => window.confirm(`Delete "${collection.name}"? Its images stay in the library.`) && run(`${base}/${collection.id}?kind=${kind}`, { method: "DELETE", success: "Deleted" })}>Delete</Button>
      </div>}
    </li>)}</ul> : <EmptyState title={`No ${text.title.toLowerCase()} yet`} />}

    <Dialog open={creating} onClose={() => setCreating(false)} title={`New ${text.singular}`}>
      {creating && <form onSubmit={create} className="space-y-4">
        <TextField label="Name" name="name" required placeholder={kind === "portfolio" ? "Commercial" : "Digitals — September"} />
        {kind === "portfolio" && <TextareaField label="Description" name="description" rows={3} />}
        <CheckboxField label="Public" name="public" hint="Can appear on the website once published." />
        {kind === "portfolio" && <CheckboxField label="Default portfolio" name="is_default" hint="Shown first on the profile." />}
        <div className="flex justify-end gap-2 border-t border-[#efefeb] pt-4"><Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button><Button type="submit" disabled={pending}>Create</Button></div>
      </form>}
    </Dialog>

    <Dialog open={Boolean(editing)} onClose={() => setEditing(null)} title={`Edit ${text.singular}`} description="Select images from the library, then arrange them." wide>
      {editing && <form onSubmit={save} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Name" name="name" required defaultValue={editing.name} />
          <div className="grid gap-2">
            <CheckboxField label="Public" name="public" defaultChecked={editing.public} />
            {kind === "portfolio" && <CheckboxField label="Default portfolio" name="is_default" defaultChecked={editing.is_default} />}
          </div>
          {kind === "portfolio" && <TextareaField label="Description" name="description" defaultValue={editing.description} rows={2} className="sm:col-span-2" />}
        </div>

        <div>
          <p className="text-[10px] font-800 uppercase tracking-[.14em] text-[#6f716b]">In this {text.singular} ({selection.length})</p>
          {selection.length ? <ol className="mt-2 space-y-1.5">{selection.map((id, index) => <li key={id} className="flex items-center gap-3 rounded-md border border-[#e7e7e3] px-2 py-1.5 text-xs">
            <span className="w-5 text-[#717369]">{index + 1}</span><Thumb src={photoById.get(id)?.url ?? null} alt="" className="h-10 w-8" />
            <span className="flex-1 truncate">{photoById.get(id)?.title || "Untitled"}</span>
            {!photoById.get(id)?.public && <Badge tone="private">Private</Badge>}
            <button type="button" aria-label="Move earlier" onClick={() => move(index, -1)} disabled={index === 0} className="p-1 disabled:opacity-30"><ArrowUp size={13} /></button>
            <button type="button" aria-label="Move later" onClick={() => move(index, 1)} disabled={index === selection.length - 1} className="p-1 disabled:opacity-30"><ArrowDown size={13} /></button>
            <button type="button" aria-label="Remove from collection" onClick={() => setSelection(selection.filter((item) => item !== id))} className="p-1 text-[#a9593d]"><X size={13} /></button>
          </li>)}</ol> : <p className="mt-2 text-xs text-[#717369]">Nothing selected yet.</p>}
        </div>

        <div>
          <p className="text-[10px] font-800 uppercase tracking-[.14em] text-[#6f716b]">Library</p>
          <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-6">{photos.map((photo) => {
            const chosen = selection.includes(photo.id);
            return <button type="button" key={photo.id} aria-pressed={chosen} onClick={() => setSelection(chosen ? selection.filter((id) => id !== photo.id) : [...selection, photo.id])}
              className={`relative overflow-hidden rounded border-2 ${chosen ? "border-[#a4502f]" : "border-transparent"}`}>
              <Thumb src={photo.url} alt={photo.alt_text || photo.title || "Library image"} className="aspect-[3/4] h-auto w-full" />
              {chosen && <span className="absolute right-1 top-1 rounded-full bg-[#a4502f] px-1.5 text-[9px] font-800 text-white">{selection.indexOf(photo.id) + 1}</span>}
            </button>;
          })}</div>
        </div>

        <div className="flex justify-end gap-2 border-t border-[#efefeb] pt-4"><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" disabled={pending}>Save</Button></div>
      </form>}
    </Dialog>
  </section>;
}
