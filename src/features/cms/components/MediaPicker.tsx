"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { createClient } from "@/lib/supabase/client";

// The public "cms-media" bucket: images used on website pages. Files are
// uploaded straight from the browser (storage policies require website.manage).
export type MediaItem = { path: string; url: string; size: number | null };
const TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 15 * 1024 * 1024;

export function mediaUrl(path: string | null | undefined) {
  if (!path) return null;
  return createClient().storage.from("cms-media").getPublicUrl(path).data.publicUrl;
}

export function useMediaLibrary() {
  const toast = useToast();
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const client = createClient();
    const { data, error } = await client.storage.from("cms-media").list("cms", { limit: 300, sortBy: { column: "created_at", order: "desc" } });
    if (error) { toast.error("The media library could not be loaded."); setItems([]); return; }
    setItems((data ?? []).filter((item) => item.id).map((item) => ({ path: `cms/${item.name}`, url: mediaUrl(`cms/${item.name}`) as string, size: (item.metadata?.size as number | undefined) ?? null })));
  }, [toast]);

  const upload = useCallback(async (files: File[]) => {
    const valid = files.filter((file) => TYPES.includes(file.type) && file.size <= MAX_BYTES);
    if (valid.length < files.length) toast.error("Only JPG, PNG or WebP images up to 15 MB can be uploaded.");
    if (!valid.length) return [];
    setBusy(true);
    const client = createClient();
    const uploaded: string[] = [];
    for (const file of valid) {
      const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
      const base = file.name.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "image";
      const path = `cms/${base}-${crypto.randomUUID().slice(0, 8)}.${extension}`;
      const { error } = await client.storage.from("cms-media").upload(path, file, { contentType: file.type, cacheControl: "31536000" });
      if (error) toast.error(`${file.name} could not be uploaded.`);
      else uploaded.push(path);
    }
    setBusy(false);
    if (uploaded.length) toast.success(`${uploaded.length} image${uploaded.length === 1 ? "" : "s"} uploaded`);
    await load();
    return uploaded;
  }, [load, toast]);

  const remove = useCallback(async (path: string) => {
    const { error } = await createClient().storage.from("cms-media").remove([path]);
    if (error) toast.error("The image could not be deleted.");
    else { toast.success("Image deleted"); await load(); }
  }, [load, toast]);

  return { items, busy, load, upload, remove };
}

export function MediaGrid({ items, selected, onSelect, onRemove }: { items: MediaItem[]; selected?: string | null; onSelect?: (path: string) => void; onRemove?: (path: string) => void }) {
  if (!items.length) return <p className="py-8 text-center text-sm text-[#6b6d66]">No images yet. Upload one to get started.</p>;
  return <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">{items.map((item) => <li key={item.path} className="group relative">
    <button type="button" onClick={() => onSelect?.(item.path)} disabled={!onSelect} aria-pressed={selected === item.path}
      className={`block aspect-square w-full overflow-hidden rounded-lg bg-[#efefeb] ring-2 ${selected === item.path ? "ring-[#a4502f]" : "ring-transparent hover:ring-[#dcdcd6]"}`}>
      {/* Public CMS image; next/image adds nothing in the editor grid. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={item.url} alt="" loading="lazy" className="h-full w-full object-cover" />
    </button>
    <p className="mt-1 truncate text-[10px] text-[#6b6d66]" title={item.path}>{item.path.replace(/^cms\//, "")}</p>
    {onRemove && <button type="button" aria-label={`Delete ${item.path}`} onClick={() => window.confirm("Delete this image? Pages that use it will show no image.") && onRemove(item.path)}
      className="absolute right-1.5 top-1.5 rounded bg-white/90 p-1 text-[#a9593d] opacity-0 shadow group-hover:opacity-100 focus:opacity-100"><Trash2 size={13} /></button>}
  </li>)}</ul>;
}

export function UploadButton({ onFiles, busy }: { onFiles: (files: File[]) => void; busy: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return <>
    <input ref={input} type="file" accept={TYPES.join(",")} multiple className="sr-only" aria-label="Upload images" onChange={(event) => { onFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
    <Button size="sm" icon={<Upload size={13} />} disabled={busy} onClick={() => input.current?.click()}>{busy ? "Uploading…" : "Upload images"}</Button>
  </>;
}

// A field that stores a cms-media path, with a thumbnail and a picker dialog.
export function MediaField({ label, value, onChange, hint }: { label: string; value: string | null | undefined; onChange: (path: string | null) => void; hint?: string }) {
  const [open, setOpen] = useState(false);
  const library = useMediaLibrary();
  const { load } = library;
  useEffect(() => { if (open) void load(); }, [open, load]);
  const url = mediaUrl(value);

  return <div className="text-[10px] font-800 uppercase tracking-[.14em] text-[#6f716b]">
    {label}
    <div className="mt-2 flex items-center gap-3">
      <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[#efefeb]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <ImagePlus size={18} className="text-[#717369]" aria-hidden />}
      </div>
      <div className="flex flex-wrap gap-2 normal-case tracking-normal">
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>{value ? "Change image" : "Choose image"}</Button>
        {value && <Button size="sm" variant="ghost" icon={<X size={13} />} onClick={() => onChange(null)}>Remove</Button>}
      </div>
    </div>
    {hint && <p className="mt-1.5 text-[11px] font-400 normal-case tracking-normal text-[#6b6d66]">{hint}</p>}
    <Dialog open={open} onClose={() => setOpen(false)} title="Choose an image" description="Images in the website media library are public once used on a published page." wide
      footer={<UploadButton busy={library.busy} onFiles={async (files) => { const [first] = await library.upload(files); if (first) { onChange(first); setOpen(false); } }} />}>
      {library.items ? <MediaGrid items={library.items} selected={value} onSelect={(path) => { onChange(path); setOpen(false); }} /> : <p className="py-8 text-center text-sm text-[#6b6d66]">Loading…</p>}
    </Dialog>
  </div>;
}
