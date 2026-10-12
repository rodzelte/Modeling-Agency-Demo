"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextField } from "@/components/ui/Field";
import { useMutation } from "@/lib/use-mutation";

export function NewPackageButton() {
  const router = useRouter();
  const { run, pending } = useMutation();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const created = await run<{ id: string }>("/api/dashboard/packages", { body: { title }, success: "Package created", refresh: false });
    if (created?.id) router.push(`/dashboard/packages/${created.id}`);
  }
  return <>
    <Button icon={<Plus size={14} />} onClick={() => setOpen(true)}>New package</Button>
    <Dialog open={open} onClose={() => setOpen(false)} title="New package">
      <form onSubmit={create} className="space-y-4">
        <TextField label="Title" name="title" required value={title} onChange={setTitle} placeholder="e.g. Acme swim casting — October" />
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={pending}>Create</Button></div>
      </form>
    </Dialog>
  </>;
}
