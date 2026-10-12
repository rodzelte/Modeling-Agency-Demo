// A team member's profile photo, uploaded in My profile to the team-avatars
// bucket. Stored under its own key because Google overwrites avatar_url at each
// sign-in, and Google picture URLs are not allowed by the CSP (img-src: Supabase).
export const PROFILE_PHOTO_BUCKET = "team-avatars";

export function profilePhotoUrl(metadata: Record<string, unknown> | null | undefined): string | null {
  const value = metadata?.profile_photo_url;
  return typeof value === "string" && profilePhotoPath(value) ? value : null;
}

// The storage path inside team-avatars for a public URL we issued, if it is one.
export function profilePhotoPath(url: string | null | undefined): string | null {
  const marker = `/storage/v1/object/public/${PROFILE_PHOTO_BUCKET}/`;
  const index = url?.indexOf(marker) ?? -1;
  return url && index >= 0 ? decodeURIComponent(url.slice(index + marker.length).split("?")[0]) : null;
}
