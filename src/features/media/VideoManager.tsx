"use client";

import { useRef, useState } from "react";
import { Archive, Globe2, Link2, Lock, Upload } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { createClient } from "@/lib/supabase/client";
import { useMutation } from "@/lib/use-mutation";
import { watchUrl } from "./video";
import { MAX_VIDEO_BYTES, type MediaVideo } from "./types";

const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];

export function VideoManager({ talentId, videos, canManage }: { talentId: string; videos: MediaVideo[]; canManage: boolean }) {
  const { run, pending } = useMutation();
  const toast = useToast();
  const [link, setLink] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const base = `/api/dashboard/talents/${talentId}/media/videos`;

  async function addLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await run(base, { body: { url: link }, success: "Video added (private until made public)" })) setLink("");
  }

  async function uploadFile(file: File | undefined) {
    if (!file) return;
    if (!VIDEO_TYPES.includes(file.type) || file.size > MAX_VIDEO_BYTES) return toast.error("Upload an MP4, WebM, or MOV file up to 50 MB, or add a YouTube/Vimeo link instead.");
    setUploading(true);
    const path = `talent/${talentId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-80)}`;
    const stored = await createClient().storage.from("talent-private").upload(path, file, { contentType: file.type });
    if (stored.error) toast.error("The video could not be uploaded.");
    else await run(base, { body: { storage_path: path, title: file.name.replace(/\.[^.]+$/, "") }, success: "Video uploaded (private until made public)" });
    setUploading(false);
  }

  return <section className="space-y-4">
    <div><h3 className="text-sm font-800">Videos</h3><p className="mt-1 text-xs text-[#6b6d66]">YouTube and Vimeo links, or uploaded clips. Shown on the website only when public and the talent&apos;s &quot;Show videos&quot; setting is on.</p></div>
    {canManage && <div className="flex flex-col gap-3 rounded-lg border border-[#e7e7e3] p-4 sm:flex-row sm:items-end">
      <form onSubmit={addLink} className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-end">
        <TextField label="YouTube or Vimeo link" name="url" type="url" value={link} onChange={setLink} placeholder="https://www.youtube.com/watch?v=…" className="flex-1" />
        <Button type="submit" size="sm" icon={<Link2 size={13} />} disabled={pending || !link}>Add link</Button>
      </form>
      <input ref={fileInput} type="file" accept={VIDEO_TYPES.join(",")} className="sr-only" aria-label="Upload video" onChange={(event) => { void uploadFile(event.target.files?.[0]); event.target.value = ""; }} />
      <Button size="sm" variant="secondary" icon={<Upload size={13} />} disabled={uploading} onClick={() => fileInput.current?.click()}>{uploading ? "Uploading…" : "Upload file"}</Button>
    </div>}
    {videos.length ? <ul className="divide-y divide-[#efefeb] rounded-lg border border-[#e7e7e3]">{videos.map((video) => {
      const href = video.external_id ? watchUrl(video.provider, video.external_id) : null;
      return <li key={video.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-xs">
        <Badge>{video.provider}</Badge>
        <span className="flex-1 truncate font-700">{href ? <a href={href} target="_blank" rel="noreferrer" className="hover:text-[#a4502f]">{video.title || href}</a> : video.title || "Uploaded video"}</span>
        {video.public ? <Badge tone="public">Public</Badge> : <Badge tone="private">Private</Badge>}
        {canManage && <>
          <Button size="sm" variant="secondary" icon={video.public ? <Lock size={12} /> : <Globe2 size={12} />} disabled={pending}
            onClick={() => run(`${base}/${video.id}`, { method: "PATCH", body: { public: !video.public }, success: video.public ? "Video made private" : "Video published" })}>{video.public ? "Make private" : "Make public"}</Button>
          <Button size="sm" variant="ghost" icon={<Archive size={12} />} disabled={pending}
            onClick={() => window.confirm("Archive this video?") && run(`${base}/${video.id}`, { method: "PATCH", body: { archived: true }, success: "Video archived" })}>Archive</Button>
        </>}
      </li>;
    })}</ul> : <EmptyState title="No videos yet" />}
  </section>;
}
