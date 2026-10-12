"use client";

import { Archive, ArchiveRestore, Eye, Globe2, Send, Star, Undo2 } from "lucide-react";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Thumb } from "@/components/ui/Thumb";
import { useMutation } from "@/lib/use-mutation";
import { CrmBadges } from "@/features/ghl/components/CrmBadges";
import type { TalentCore } from "../types";
import { talentSummary } from "../summary";

export function TalentHeader({ talent, age, thumbnail, canPublish, canArchive, boardCount, photos }: {
  talent: TalentCore; age: number | null; thumbnail: string | null; canPublish: boolean; canArchive: boolean; boardCount: number;
  // Photos on the website, and private approved photos that could be (null when the viewer cannot manage media).
  photos?: { onWebsite: number; ready: number } | null;
}) {
  const { run, pending } = useMutation();
  const live = talent.publication_status === "published" && talent.show_on_website;
  const archived = talent.publication_status === "archived";
  const act = (action: string, success: string) => run(`/api/dashboard/talents/${talent.id}/publication`, { body: { action }, success });

  async function publish() {
    // The website shows only photos marked "On website": offer to add them first.
    if (photos && photos.onWebsite === 0) {
      if (photos.ready > 0) {
        if (window.confirm(`None of ${talent.display_name}'s photos are on the website yet, so the profile would have no pictures.

OK: show all ${photos.ready} photo${photos.ready === 1 ? "" : "s"} on the website, then publish.
Cancel: go back without publishing.`)) {
          const shown = await run(`/api/dashboard/talents/${talent.id}/media/publish-all`, { refresh: false });
          if (!shown) return;
        } else return;
      } else if (!window.confirm("This model has no photos to show, so the website will display a placeholder. Upload photos in the Media tab first, or publish anyway?")) return;
    }
    if (boardCount === 0 && !window.confirm("This talent is not on any board, so it will not appear on board pages or the roster. Publish anyway?")) return;
    if (talent.is_minor && talent.consent_status !== "granted" && !window.confirm("Guardian consent is not recorded as granted for this minor. Publish anyway?")) return;
    await act("publish", "Published — the website now shows this talent");
  }

  return <header className="flex flex-col gap-5 border-b border-[#e7e7e3] pb-6 lg:flex-row lg:items-end lg:justify-between">
    <div className="flex items-end gap-4">
      <Thumb src={thumbnail} alt={talent.display_name} className="h-24 w-20" />
      <div>
        <p className="text-[10px] font-800 uppercase tracking-[.18em] text-[#a4502f]">{talent.talent_id ?? "Talent"}</p>
        <h1 className="mt-1 text-3xl font-700 tracking-[-.03em]">{talent.display_name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[#6b6d66]">
          <StatusBadge status={talent.publication_status} />
          {live ? <Badge tone="public">Live on website</Badge> : <Badge tone="private">Not on website</Badge>}
          {photos && photos.onWebsite === 0 && <Badge tone="internal">No photos on website</Badge>}
          {talent.featured && <Badge tone="review">Featured</Badge>}
          {talent.is_minor && <Badge tone="internal">Minor</Badge>}
          <CrmBadges status={talent.crm_status} programs={talent.crm_programs} />
          <span>{talentSummary(talent.location, talent.gender, age)}</span>
        </div>
      </div>
    </div>

    <div className="flex flex-wrap gap-2">
      <ButtonLink href={`/preview/talent/${talent.id}`} variant="secondary" size="sm" icon={<Eye size={13} />} target="_blank">Preview profile</ButtonLink>
      {live && <ButtonLink href={`/models/${talent.slug}`} variant="secondary" size="sm" icon={<Globe2 size={13} />} target="_blank">View live</ButtonLink>}
      {canPublish && !archived && <>
        {talent.publication_status !== "review" && !live && <Button size="sm" variant="secondary" icon={<Send size={13} />} disabled={pending} onClick={() => act("review", "Sent to review")}>Send to review</Button>}
        <Button size="sm" variant="secondary" icon={<Star size={13} />} disabled={pending}
          onClick={() => run(`/api/dashboard/talents/${talent.id}/publication`, { body: { featured: !talent.featured }, success: talent.featured ? "Removed from featured" : "Featured on the website" })}>
          {talent.featured ? "Unfeature" : "Feature"}
        </Button>
        {live
          ? <Button size="sm" variant="danger" icon={<Undo2 size={13} />} disabled={pending} onClick={() => act("unpublish", "Unpublished — removed from the website")}>Unpublish</Button>
          : <Button size="sm" variant="success" icon={<Globe2 size={13} />} disabled={pending} onClick={publish}>Publish</Button>}
      </>}
      {canArchive && (archived
        ? <Button size="sm" variant="secondary" icon={<ArchiveRestore size={13} />} disabled={pending} onClick={() => act("restore", "Restored as a draft")}>Restore</Button>
        : <Button size="sm" variant="ghost" icon={<Archive size={13} />} disabled={pending}
          onClick={() => window.confirm("Archive this talent? It is removed from the website but every record is kept.") && act("archive", "Archived")}>Archive</Button>)}
    </div>
  </header>;
}
