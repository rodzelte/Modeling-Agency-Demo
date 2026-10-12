"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArrowDown, ArrowUp, Globe2, GripVertical, Lock, Pencil, Star, Upload } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { SelectField, TextField } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { createClient } from "@/lib/supabase/client";
import { readForm } from "@/lib/read-form";
import { useMutation } from "@/lib/use-mutation";
import { IMAGE_MIME_TYPES, IMAGE_TYPES, MAX_IMAGE_BYTES, type MediaPhoto } from "./types";

export function PhotoManager({ talentId, photos, canManage }: { talentId: string; photos: MediaPhoto[]; canManage: boolean }) {
  const { run, pending } = useMutation();
  const toast = useToast();
  const router = useRouter();
  const [source, setSource] = useState(photos);
  const [order, setOrder] = useState(photos);
  const [dragging, setDragging] = useState<string | null>(null);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [editing, setEditing] = useState<MediaPhoto | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const base = `/api/dashboard/talents/${talentId}/media`;

  // Fresh server data (after router.refresh) replaces any local ordering.
  if (source !== photos) {
    setSource(photos);
    setOrder(photos);
  }

  async function upload(files: File[]) {
    const valid = files.filter((file) => IMAGE_MIME_TYPES.includes(file.type) && file.size <= MAX_IMAGE_BYTES);
    if (valid.length < files.length) toast.error("Only JPG, PNG, or WebP images up to 25 MB can be uploaded; other files were skipped.");
    if (!valid.length) return;
    const client = createClient();
    setUploading({ done: 0, total: valid.length });
    let failed = 0;
    for (const [index, file] of valid.entries()) {
      const path = `talent/${talentId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-80)}`;
      const stored = await client.storage.from("talent-private").upload(path, file, { contentType: file.type });
      const saved = stored.error ? null : await run(base, {
        body: { storage_path: path, title: file.name.replace(/\.[^.]+$/, ""), alt_text: "", original_file_name: file.name, mime_type: file.type, file_size: file.size },
        refresh: false,
      });
      if (!saved) failed += 1;
      setUploading({ done: index + 1, total: valid.length });
    }
    setUploading(null);
    if (failed) toast.error(`${failed} of ${valid.length} uploads failed.`);
    else toast.success(`${valid.length} image${valid.length === 1 ? "" : "s"} uploaded (private until made public)`);
    router.refresh();
  }

  async function saveOrder(next: MediaPhoto[]) {
    setOrder(next);
    await run(`${base}/order`, { body: { photo_ids: next.map((photo) => photo.id) }, success: "Order saved" });
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    void saveOrder(next);
  }

  function drop(targetId: string) {
    if (!dragging || dragging === targetId) return;
    const next = order.filter((photo) => photo.id !== dragging);
    next.splice(next.findIndex((photo) => photo.id === targetId), 0, order.find((photo) => photo.id === dragging)!);
    setDragging(null);
    void saveOrder(next);
  }

  async function saveDetails(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const saved = await run(`${base}/${editing.id}`, { method: "PATCH", body: readForm(event.currentTarget), success: "Image details saved" });
    if (saved) setEditing(null);
  }

  return <section className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h3 className="text-sm font-800">Images</h3><p className="mt-1 text-xs text-[#6b6d66]">New uploads are private. Click <strong>Show on website</strong> on a photo (or <strong>Show all on website</strong>) to put it on the public profile; the <strong>★ primary</strong> photo is the cover. Drag to reorder.</p></div>
      {canManage && <>
        <input ref={input} type="file" accept={IMAGE_MIME_TYPES.join(",")} multiple className="sr-only" aria-label="Upload images" onChange={(event) => { void upload(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
        <Button size="sm" icon={<Upload size={13} />} disabled={Boolean(uploading)} onClick={() => input.current?.click()}>{uploading ? `Uploading ${uploading.done}/${uploading.total}…` : "Upload images"}</Button>
      </>}
    </div>

    {canManage && order.length > 0 && (() => {
      const onSite = order.filter((photo) => photo.public).length;
      const ready = order.filter((photo) => !photo.public && (photo.review_status ?? "approved") === "approved").length;
      return <div className={`flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3 text-xs ${onSite ? "bg-[#e4eee5] text-[#3f6a45]" : "bg-[#f7ecd8] text-[#7a5520]"}`}>
        <span><strong>{onSite} of {order.length}</strong> photo{order.length === 1 ? "" : "s"} {onSite === 1 ? "is" : "are"} on the website.{!onSite && " The website shows only photos marked “On website”, so this profile will have no pictures until you add some."}</span>
        {ready > 0 && <Button size="sm" variant={onSite ? "secondary" : "primary"} icon={<Globe2 size={13} />} disabled={pending}
          onClick={async () => {
            const result = await run<{ published: number; failed: number }>(`${base}/publish-all`, {});
            if (result) toast.success(`${result.published} photo${result.published === 1 ? "" : "s"} now on the website${result.failed ? ` (${result.failed} failed)` : ""}`);
          }}>Show all on website ({ready})</Button>}
      </div>;
    })()}

    {canManage && <div onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDropActive(true); } }} onDragLeave={() => setDropActive(false)}
      onDrop={(event) => { if (event.dataTransfer.files.length) { event.preventDefault(); setDropActive(false); void upload(Array.from(event.dataTransfer.files)); } }}
      className={`rounded-lg border border-dashed px-4 py-5 text-center text-xs transition-colors ${dropActive ? "border-[#a4502f] bg-[#fdf6f3] text-[#a9593d]" : "border-[#dcdcd6] text-[#717369]"}`}>
      Drop JPG, PNG, or WebP files here (up to 25 MB each)
    </div>}

    {order.length ? <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">{order.map((photo, index) => <li key={photo.id}
      draggable={canManage} onDragStart={() => setDragging(photo.id)} onDragEnd={() => setDragging(null)} onDragOver={(event) => { if (dragging) event.preventDefault(); }} onDrop={() => drop(photo.id)}
      className={`group overflow-hidden rounded-lg border bg-white ${dragging === photo.id ? "opacity-40" : ""} ${photo.featured ? "border-[#a4502f]" : "border-[#e7e7e3]"}`}>
      <div className="relative aspect-[3/4] bg-[#efefeb]">
        {photo.url && /* eslint-disable-next-line @next/next/no-img-element -- signed private URLs bypass the shared optimizer */
          <img src={photo.url} alt={photo.alt_text || photo.title || "Talent image"} className="h-full w-full object-cover" style={photo.focal_point ? { objectPosition: `${photo.focal_point.x}% ${photo.focal_point.y}%` } : undefined} />}
        <div className="absolute left-2 top-2 flex flex-wrap gap-1">
          <span className="rounded-full bg-white/90 px-2 py-0.5 text-[9px] font-800">#{index + 1}</span>
          {photo.featured && <Badge tone="review">Primary</Badge>}
          {photo.public ? <Badge tone="public">On website</Badge> : <Badge tone="private">Private</Badge>}
          {photo.review_status === "pending" && <Badge tone="review">From talent · review</Badge>}
          {photo.review_status === "rejected" && <Badge tone="inactive">Not used</Badge>}
        </div>
        {canManage && <span className="absolute right-2 top-2 hidden cursor-grab rounded bg-white/90 p-1 text-[#6f716b] group-hover:block" aria-hidden><GripVertical size={14} /></span>}
      </div>
      <div className="space-y-2 p-3">
        <p className="truncate text-xs font-700" title={photo.title ?? undefined}>{photo.title || "Untitled"}</p>
        {photo.photographer && <p className="truncate text-[11px] text-[#6b6d66]">© {photo.photographer}</p>}
        {canManage && photo.review_status === "pending" && <div className="flex gap-1.5">
          <Button size="sm" variant="success" disabled={pending} onClick={() => run(`${base}/${photo.id}`, { method: "PATCH", body: { review_status: "approved" }, success: "Digital approved" })}>Approve</Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(`${base}/${photo.id}`, { method: "PATCH", body: { review_status: "rejected" }, success: "Marked as not used" })}>Reject</Button>
        </div>}
        {canManage && <Button size="sm" className="w-full" variant={photo.public ? "success" : "secondary"} icon={photo.public ? <Globe2 size={13} /> : <Lock size={13} />}
          disabled={pending || (!photo.public && Boolean(photo.review_status) && photo.review_status !== "approved")}
          title={photo.public ? "Click to remove from the website (the original is kept)" : "Click to show this photo on the website"}
          onClick={() => run(`${base}/${photo.id}`, { method: "PATCH", body: { public: !photo.public }, success: photo.public ? "Removed from the website" : "Now on the website" })}>
          {photo.public ? "On website" : photo.review_status && photo.review_status !== "approved" ? "Approve first" : "Show on website"}
        </Button>}
        {canManage && <div className="flex flex-wrap gap-1">
          <IconButton label="Move earlier" onClick={() => move(index, -1)} disabled={pending || index === 0}><ArrowUp size={13} /></IconButton>
          <IconButton label="Move later" onClick={() => move(index, 1)} disabled={pending || index === order.length - 1}><ArrowDown size={13} /></IconButton>
          <IconButton label={photo.featured ? "Primary image" : "Make primary image"} disabled={pending || photo.featured} onClick={() => run(`${base}/featured`, { body: { photo_id: photo.id }, success: "Primary image set" })}><Star size={13} /></IconButton>
          <IconButton label="Edit details" onClick={() => setEditing(photo)}><Pencil size={13} /></IconButton>
          <IconButton label="Archive image" disabled={pending} onClick={() => window.confirm("Archive this image? It is removed from the website and hidden here; the original file is kept.") && run(`${base}/${photo.id}`, { method: "PATCH", body: { archived: true }, success: "Image archived" })}><Archive size={13} /></IconButton>
        </div>}
      </div>
    </li>)}</ul> : <EmptyState title="No images yet">{canManage ? "Upload images to build this talent's book." : undefined}</EmptyState>}

    <Dialog open={Boolean(editing)} onClose={() => setEditing(null)} title="Image details" description="Alt text describes the image for screen readers and search engines." wide>
      {editing && <form onSubmit={saveDetails} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Title" name="title" defaultValue={editing.title} />
          <TextField label="Alt text" name="alt_text" defaultValue={editing.alt_text} />
          <TextField label="Photographer" name="photographer" defaultValue={editing.photographer} />
          <SelectField label="Image type" name="image_type" defaultValue={editing.image_type} options={IMAGE_TYPES} />
          <TextField label="Type of work" name="type_of_work" defaultValue={editing.type_of_work} hint="e.g. Editorial, Campaign" />
          <TextField label="Publication / client" name="support_name" defaultValue={editing.support_name} />
          <TextField label="Country of publication" name="country_of_publication" defaultValue={editing.country_of_publication} />
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Focal X (%)" name="focal_x" type="number" min={0} max={100} defaultValue={editing.focal_point?.x ?? 50} />
            <TextField label="Focal Y (%)" name="focal_y" type="number" min={0} max={100} defaultValue={editing.focal_point?.y ?? 50} />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-[#efefeb] pt-4"><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" disabled={pending}>Save</Button></div>
      </form>}
    </Dialog>
  </section>;
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled}
    className="rounded border border-[#e7e7e3] p-1.5 text-[#5f615b] hover:border-[#20211f] hover:text-[#20211f] disabled:cursor-not-allowed disabled:opacity-40">{children}</button>;
}
