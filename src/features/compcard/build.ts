import "server-only";
import { createElement } from "react";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { feetInches, lengthLabel } from "@/lib/format";
import { siteOrigin } from "@/lib/site";
import { getSiteSettings } from "@/features/cms/queries";
import { CompCardDocument, type CompCardData } from "./CompCardDocument";

// Builds a comp card from APPROVED material only: photos marked public (served
// from talent-public) and measurements the talent allows to be public. Private
// contact, legal and unapproved photos are never read.

export type CompCardPhoto = { id: string; public_storage_path: string; alt_text: string | null; featured: boolean };

export async function approvedPhotos(supabase: SupabaseClient, talentId: string) {
  const { data, error } = await supabase.from("talent_photos").select("id,public_storage_path,alt_text,featured")
    .eq("talent_id", talentId).eq("public", true).not("public_storage_path", "is", null).is("archived_at", null)
    .order("featured", { ascending: false }).order("display_order");
  if (error) throw error;
  return (data ?? []) as CompCardPhoto[];
}

export async function publicStats(supabase: SupabaseClient, talentId: string, gender: string | null) {
  const { data } = await supabase.from("talent_measurements").select("height_cm,bust_chest_cm,waist_cm,hips_cm,shoe_size_us,suit_size,hair_color,eye_color")
    .eq("talent_id", talentId).order("is_official", { ascending: false }).order("measured_on", { ascending: false }).limit(1).maybeSingle();
  if (!data) return [];
  return ([
    ["Height", data.height_cm ? feetInches(data.height_cm) : null],
    [gender?.toLowerCase() === "male" ? "Chest" : "Bust", lengthLabel(data.bust_chest_cm)],
    ["Waist", lengthLabel(data.waist_cm)], ["Hips", lengthLabel(data.hips_cm)],
    ["Shoe", data.shoe_size_us ? `${data.shoe_size_us} US` : null], ["Suit", data.suit_size],
    ["Hair", data.hair_color], ["Eyes", data.eye_color],
  ] as [string, string | null][]).filter(([, value]) => value).map(([label, value]) => ({ label, value: value as string }));
}

// Fetches a public image and re-encodes it as JPEG (react-pdf does not read WebP).
async function jpeg(url: string, width: number) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`image fetch failed (${response.status})`);
  return sharp(Buffer.from(await response.arrayBuffer())).rotate().resize({ width, withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
}

export async function renderCompCard(supabase: SupabaseClient, talentId: string, options: { photoIds: string[]; measurements: boolean }) {
  const { data: talent, error } = await supabase.from("talent").select("id,display_name,location,gender,show_measurements").eq("id", talentId).maybeSingle();
  if (error) throw error;
  if (!talent) return null;
  const photos = await approvedPhotos(supabase, talentId);
  const byId = new Map(photos.map((photo) => [photo.id, photo]));
  const chosen = options.photoIds.map((id) => byId.get(id)).filter(Boolean) as CompCardPhoto[];
  const selection = chosen.length ? chosen : photos.slice(0, 5);
  if (!selection.length) return { error: "This talent has no photos approved for public use. Make at least one photo public first." } as const;

  const url = (path: string) => supabase.storage.from("talent-public").getPublicUrl(path).data.publicUrl;
  const [primary, ...supporting] = await Promise.all(selection.slice(0, 5).map((photo, index) => jpeg(url(photo.public_storage_path), index === 0 ? 1400 : 800)));
  const settings = await getSiteSettings();
  const card: CompCardData = {
    name: talent.display_name,
    location: talent.location,
    primary,
    supporting: supporting.length ? supporting : [primary],
    stats: options.measurements && talent.show_measurements ? await publicStats(supabase, talentId, talent.gender) : [],
    contact: { email: settings.contact_email, phone: settings.contact_phone, website: siteOrigin()?.replace(/^https?:\/\//, "") ?? null, locationLine: settings.location_line },
  };
  const { renderToBuffer } = await import("@react-pdf/renderer");
  const pdf = await renderToBuffer(createElement(CompCardDocument, { card }) as Parameters<typeof renderToBuffer>[0]);
  return { pdf, name: talent.display_name } as const;
}
