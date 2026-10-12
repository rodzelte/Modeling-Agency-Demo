"use client";

import { Button } from "@/components/ui/Button";
import { CheckboxField, FormGrid, FormSection, SelectField, TextareaField, TextField } from "@/components/ui/Field";
import { readForm } from "@/lib/read-form";
import { useMutation } from "@/lib/use-mutation";
import { ageFromDob } from "@/lib/format";
import { CONSENT_OPTIONS, GENDER_OPTIONS, type TalentCore, type TalentPrivate } from "../types";

const CORE_FIELDS = ["first_name", "last_name", "display_name", "slug", "talent_id", "location", "gender", "date_joined", "status", "public_bio", "is_minor", "guardian_required", "consent_status", "guardian_contact_id",
  "show_age", "show_measurements", "show_portfolio", "show_videos", "show_resume", "show_comp_card"];
const PRIVATE_FIELDS = ["date_of_birth", "birth_place", "nationality", "mobile", "phone", "email", "website", "notes"];

function pick(values: Record<string, string | boolean>, keys: string[]) {
  return Object.fromEntries(keys.filter((key) => key in values).map((key) => [key, values[key]]));
}

export function GeneralTab({ talent, privateDetails, canEdit, canViewPrivate, canEditPrivate, guardians }: {
  talent: TalentCore; privateDetails: TalentPrivate | null; canEdit: boolean; canViewPrivate: boolean; canEditPrivate: boolean; guardians: { id: string; name: string }[];
}) {
  const { run, pending } = useMutation();
  const age = ageFromDob(privateDetails?.date_of_birth);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = readForm(event.currentTarget);
    await run(`/api/dashboard/talents/${talent.id}`, {
      method: "PATCH",
      body: { core: canEdit ? pick(values, CORE_FIELDS) : undefined, private: canEditPrivate ? pick(values, PRIVATE_FIELDS) : undefined },
      success: "Talent saved",
    });
  }

  return <form onSubmit={submit} className="space-y-8">
    <FormSection title="Identity">
      <FormGrid columns={3}>
        <TextField label="First name" name="first_name" required defaultValue={talent.first_name} disabled={!canEdit} />
        <TextField label="Last name" name="last_name" defaultValue={talent.last_name} disabled={!canEdit} />
        <TextField label="Display name" name="display_name" required defaultValue={talent.display_name} disabled={!canEdit} hint="Shown on the website" />
        <TextField label="Talent ID" name="talent_id" defaultValue={talent.talent_id} disabled={!canEdit} />
        <TextField label="Website URL slug" name="slug" required defaultValue={talent.slug} disabled={!canEdit} hint={`/models/${talent.slug}`} />
        <SelectField label="Gender" name="gender" defaultValue={talent.gender} options={GENDER_OPTIONS} placeholder="Not set" disabled={!canEdit} />
        <TextField label="Location" name="location" defaultValue={talent.location} disabled={!canEdit} hint="Public city, e.g. Dallas" />
        <TextField label="Date joined agency" name="date_joined" type="date" defaultValue={talent.date_joined} disabled={!canEdit} />
        <SelectField label="Internal status" name="status" defaultValue={talent.status} disabled={!canEdit}
          options={[{ value: "active", label: "Active" }, { value: "on_hold", label: "On hold" }, { value: "inactive", label: "Inactive" }, { value: "former", label: "Former" }]} />
      </FormGrid>
    </FormSection>

    {canViewPrivate && <FormSection title="Private details" description="Only roles with private-detail access can see these. They never appear on the website.">
      <FormGrid columns={3}>
        <TextField label="Date of birth" name="date_of_birth" type="date" defaultValue={privateDetails?.date_of_birth} disabled={!canEditPrivate} hint={age !== null ? `Age ${age}` : undefined} />
        <TextField label="Birth place" name="birth_place" defaultValue={privateDetails?.birth_place} disabled={!canEditPrivate} />
        <TextField label="Nationality" name="nationality" defaultValue={privateDetails?.nationality} disabled={!canEditPrivate} />
        <TextField label="Mobile" name="mobile" type="tel" defaultValue={privateDetails?.mobile} disabled={!canEditPrivate} />
        <TextField label="Phone" name="phone" type="tel" defaultValue={privateDetails?.phone} disabled={!canEditPrivate} />
        <TextField label="Email" name="email" type="email" defaultValue={privateDetails?.email} disabled={!canEditPrivate} />
        <TextField label="Personal website" name="website" defaultValue={privateDetails?.website} disabled={!canEditPrivate} className="sm:col-span-2" />
      </FormGrid>
      <div className="mt-5"><TextareaField label="Internal notes" name="notes" defaultValue={privateDetails?.notes} disabled={!canEditPrivate} hint="Staff-only summary. Use the Notes tab for a dated log." /></div>
    </FormSection>}

    <FormSection title="Minor & guardian" description="Minors need guardian consent before their profile is published.">
      <FormGrid columns={3}>
        <CheckboxField label="Child / minor" name="is_minor" defaultChecked={talent.is_minor} disabled={!canEdit} />
        <CheckboxField label="Guardian required" name="guardian_required" defaultChecked={talent.guardian_required} disabled={!canEdit} />
        <SelectField label="Consent status" name="consent_status" defaultValue={talent.consent_status} options={CONSENT_OPTIONS} disabled={!canEdit} />
        <SelectField label="Guardian contact" name="guardian_contact_id" defaultValue={talent.guardian_contact_id} placeholder="None"
          options={guardians.map((guardian) => ({ value: guardian.id, label: guardian.name }))} disabled={!canEdit}
          hint={guardians.length ? undefined : "Add a parent or guardian on the Contacts tab first."} />
      </FormGrid>
    </FormSection>

    <FormSection title="Website profile" description="What the public profile may show once the talent is published.">
      <TextareaField label="Public bio" name="public_bio" defaultValue={talent.public_bio} disabled={!canEdit} rows={4} />
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <CheckboxField label="Show measurements" name="show_measurements" defaultChecked={talent.show_measurements} disabled={!canEdit} />
        <CheckboxField label="Show portfolios" name="show_portfolio" defaultChecked={talent.show_portfolio} disabled={!canEdit} />
        <CheckboxField label="Show videos" name="show_videos" defaultChecked={talent.show_videos} disabled={!canEdit} />
        <CheckboxField label="Show age" name="show_age" defaultChecked={talent.show_age} disabled={!canEdit} hint="Age only — never the date of birth." />
        <CheckboxField label="Show resume" name="show_resume" defaultChecked={talent.show_resume} disabled={!canEdit} />
        <CheckboxField label="Show comp card" name="show_comp_card" defaultChecked={talent.show_comp_card} disabled={!canEdit} />
      </div>
    </FormSection>

    {(canEdit || canEditPrivate) && <div className="flex justify-end border-t border-[#efefeb] pt-5"><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save changes"}</Button></div>}
  </form>;
}
