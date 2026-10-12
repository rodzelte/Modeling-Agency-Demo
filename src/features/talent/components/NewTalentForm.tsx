"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { CheckboxField, FormGrid, FormSection, SelectField, TextField } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { readForm } from "@/lib/read-form";
import { useMutation } from "@/lib/use-mutation";
import { GENDER_OPTIONS } from "../types";

type BoardChoice = { id: string; label: string; isPublic: boolean };

export function NewTalentForm({ boards, canSetDob, canAssignBoards }: { boards: BoardChoice[]; canSetDob: boolean; canAssignBoards: boolean }) {
  const router = useRouter();
  const { run, pending } = useMutation();
  const [selected, setSelected] = useState<string[]>([]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = readForm(event.currentTarget);
    const created = await run<{ id: string }>("/api/dashboard/talents", { body: { ...values, board_ids: selected }, success: "Talent created as a draft", refresh: false });
    if (created?.id) router.push(`/dashboard/talent/${created.id}`);
  }

  return <form onSubmit={submit} className="space-y-8 rounded-xl border border-[#e7e7e3] bg-white p-6">
    <FormSection title="Identity">
      <FormGrid>
        <TextField label="First name" name="first_name" required autoComplete="off" />
        <TextField label="Last name" name="last_name" autoComplete="off" />
        <TextField label="Display name" name="display_name" hint="Shown on the website. Defaults to first and last name." />
        <SelectField label="Gender" name="gender" options={GENDER_OPTIONS} placeholder="Not set" />
        <TextField label="Location" name="location" hint="City shown publicly, e.g. Dallas." />
        {canSetDob && <TextField label="Date of birth" name="date_of_birth" type="date" hint="Private. Used to calculate age." />}
      </FormGrid>
      <div className="mt-5 max-w-md"><CheckboxField label="Minor / child" name="is_minor" hint="Requires guardian consent before publishing." /></div>
    </FormSection>

    {canAssignBoards && <FormSection title="Boards" description="Boards decide where the talent appears on the website once published. You can change this later.">
      {boards.length ? <div className="grid gap-2 sm:grid-cols-2">{boards.map((board) => <label key={board.id} className="flex items-center gap-3 rounded-md border border-[#e7e7e3] px-3 py-2.5 text-xs">
        <input type="checkbox" checked={selected.includes(board.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, board.id] : current.filter((id) => id !== board.id))} className="h-4 w-4 accent-[#20211f]" />
        <span className="flex-1">{board.label}</span>{!board.isPublic && <Badge tone="internal">Internal</Badge>}
      </label>)}</div> : <p className="text-xs text-[#6b6d66]">No active boards yet.</p>}
    </FormSection>}

    <div className="flex justify-end gap-2 border-t border-[#efefeb] pt-6">
      <Button variant="ghost" onClick={() => router.back()}>Cancel</Button>
      <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create draft"}</Button>
    </div>
  </form>;
}
