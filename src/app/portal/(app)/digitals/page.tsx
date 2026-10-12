import { formatDate } from "@/lib/format";
import { requireEntitledPortal } from "@/features/portal/context";
import { DigitalsUploader } from "@/features/portal/components/PortalForms";

export const metadata = { title: "Digitals" };

export default async function PortalDigitals() {
  const { supabase, profile } = await requireEntitledPortal();
  const { data: photos } = await supabase.from("talent_photos").select("id,storage_path,review_status,created_at").eq("uploaded_by_talent", true).is("archived_at", null).order("created_at", { ascending: false }).limit(60);
  const paths = (photos ?? []).map((photo) => photo.storage_path);
  const { data: signed } = paths.length ? await supabase.storage.from("talent-private").createSignedUrls(paths, 600) : { data: [] };
  const urls = new Map((signed ?? []).map((item) => [item.path, item.signedUrl]));
  const labels: Record<string, string> = { pending: "In review", approved: "Approved", rejected: "Not used" };

  return <div className="space-y-6">
    <div><h1 className="display text-5xl leading-none">Digitals</h1><p className="mt-2 text-sm text-[var(--muted)]">Send your agent new snapshots. They stay private until your agent approves them.</p></div>
    <DigitalsUploader talentId={profile.id} />
    {photos?.length ? <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">{photos.map((photo) => <li key={photo.id}>
      <div className="relative aspect-[3/4] overflow-hidden rounded-lg bg-[#efefeb]">
        {/* Short-lived signed URL of the talent's own private upload. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {urls.get(photo.storage_path) && <img src={urls.get(photo.storage_path) ?? undefined} alt={`Digital uploaded ${formatDate(photo.created_at)}`} className="h-full w-full object-cover" loading="lazy" />}
        <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[9px] font-800 uppercase tracking-[.12em]">{labels[photo.review_status] ?? photo.review_status}</span>
      </div>
      <p className="mt-1 text-[11px] text-[var(--muted)]">{formatDate(photo.created_at)}</p>
    </li>)}</ul> : <p className="text-sm text-[var(--muted)]">You have not uploaded any digitals yet.</p>}
  </div>;
}
