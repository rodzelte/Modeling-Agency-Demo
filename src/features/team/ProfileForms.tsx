"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { createClient } from "@/lib/supabase/client";
import { PROFILE_PHOTO_BUCKET, profilePhotoPath } from "./photo";

const SIZE = 512;

// Crops the picked image to a centred square and re-encodes it as a 512px JPEG,
// so large phone photos upload quickly and stay under the bucket's 5 MB limit.
async function squareJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  canvas.getContext("2d")!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("encode"))), "image/jpeg", 0.88));
}

export function ProfilePhotoForm({ userId, name, photoUrl }: { userId: string; name: string; photoUrl: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  // Saves the new URL on the account, then removes the previous upload (if any).
  async function save(url: string | null) {
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ data: { profile_photo_url: url } });
    if (error) throw error;
    const previous = profilePhotoPath(photoUrl);
    if (previous) await supabase.storage.from(PROFILE_PHOTO_BUCKET).remove([previous]);
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return toast.error("Choose a JPG, PNG or WebP image.");
    setBusy(true);
    try {
      const blob = await squareJpeg(file);
      const supabase = createClient();
      const path = `${userId}/${Date.now()}.jpg`;
      const { error } = await supabase.storage.from(PROFILE_PHOTO_BUCKET).upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000" });
      if (error) throw error;
      await save(supabase.storage.from(PROFILE_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl);
      toast.success("Profile photo updated");
      router.refresh();
    } catch {
      toast.error("The photo could not be uploaded. Try a different image.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await save(null);
      toast.success("Profile photo removed");
      router.refresh();
    } catch {
      toast.error("The photo could not be removed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="flex flex-wrap items-center gap-5">
    {photoUrl
      // eslint-disable-next-line @next/next/no-img-element -- small avatar from Storage
      ? <img src={photoUrl} alt={`${name}, profile photo`} className="h-24 w-24 rounded-full object-cover" />
      : <span aria-hidden className="flex h-24 w-24 items-center justify-center rounded-full bg-[#20211f] text-3xl font-800 text-white">{name.slice(0, 1).toUpperCase()}</span>}
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => input.current?.click()} disabled={busy}><Camera size={14} /> {busy ? "Saving…" : photoUrl ? "Change photo" : "Upload photo"}</Button>
        {photoUrl && <Button variant="secondary" onClick={remove} disabled={busy}><Trash2 size={14} /> Remove</Button>}
      </div>
      <p className="text-[11px] text-[#6b6d66]">JPG, PNG or WebP. It is cropped to a square.</p>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-hidden onChange={(event) => upload(event.target.files?.[0])} />
    </div>
  </div>;
}

export function ChangePasswordForm() {
  const toast = useToast();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 10) return toast.error("Use at least 10 characters.");
    if (password !== confirm) return toast.error("The two passwords do not match.");
    setBusy(true);
    const { error } = await createClient().auth.updateUser({ password, data: { must_change_password: false } });
    setBusy(false);
    if (error) {
      toast.error(error.code === "weak_password" || error.code === "same_password" ? error.message
        : error.code === "reauthentication_needed" ? "For security, sign out and use “Forgot password” on the sign-in page." : "The password could not be changed. Try again.");
      return;
    }
    setPassword("");
    setConfirm("");
    toast.success("Password changed");
  }

  return <form onSubmit={submit} className="grid max-w-xl gap-4 sm:grid-cols-2">
    <TextField label="New password" name="password" type="password" autoComplete="new-password" required value={password} onChange={setPassword} hint="At least 10 characters." />
    <TextField label="Confirm new password" name="confirm" type="password" autoComplete="new-password" required value={confirm} onChange={setConfirm} />
    <div className="sm:col-span-2"><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Change password"}</Button></div>
  </form>;
}
