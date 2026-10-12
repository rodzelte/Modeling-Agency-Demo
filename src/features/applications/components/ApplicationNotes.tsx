"use client";

import { useState } from "react";
import { Card } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { formatDateTime } from "@/lib/format";
import { useMutation } from "@/lib/use-mutation";

export function ApplicationNotes({ id, notes, canAdd }: { id: string; notes: { id: string; body: string; created_at: string; author: string }[]; canAdd: boolean }) {
  const { run, pending } = useMutation();
  const [body, setBody] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await run(`/api/dashboard/applications/${id}/notes`, { body: { body }, success: "Note added" })) setBody("");
  }

  return <Card title="Review notes" description="Internal only. Never shown to the applicant.">
    {canAdd && <form onSubmit={submit} className="mb-5 space-y-2">
      <label htmlFor="application-note" className="sr-only">Add a note</label>
      <textarea id="application-note" value={body} onChange={(event) => setBody(event.target.value)} rows={3} maxLength={4000} placeholder="Add a note for the team…"
        className="w-full rounded-md border border-[#dcdcd6] px-3 py-2 text-sm outline-none focus:border-[#a4502f]" />
      <div className="flex justify-end"><Button type="submit" size="sm" disabled={pending || !body.trim()}>{pending ? "Saving…" : "Add note"}</Button></div>
    </form>}
    {notes.length ? <ol className="space-y-4">{notes.map((note) => <li key={note.id} className="border-l-2 border-[#efefeb] pl-3">
      <p className="whitespace-pre-line text-sm leading-6">{note.body}</p>
      <p className="mt-1 text-[11px] text-[#6b6d66]">{note.author} · {formatDateTime(note.created_at)}</p>
    </li>)}</ol> : <p className="text-sm text-[#6b6d66]">No notes yet.</p>}
  </Card>;
}
