"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Trash2 } from "lucide-react";
import { Button, buttonClass } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { Card } from "@/components/ui/PageHeader";
import { useMutation } from "@/lib/use-mutation";

// Owner tools for data-subject requests on one talent.
export function PrivacyPanel({ talentId, name, canErase }: { talentId: string; name: string; canErase: boolean }) {
  const router = useRouter();
  const { run, pending } = useMutation();
  const [confirm, setConfirm] = useState("");
  async function erase(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!window.confirm(`Permanently erase ${name}? Every record, photo and document is deleted. This cannot be undone.`)) return;
    if (await run(`/api/dashboard/talents/${talentId}/privacy`, { body: { confirm }, success: "Talent erased", refresh: false })) router.push("/dashboard/talent");
  }
  return <div className="grid gap-6 xl:grid-cols-2">
    <Card title="Export personal data" description="Everything held about this person as a JSON file, for access or portability requests. The export is logged.">
      <a href={`/api/dashboard/talents/${talentId}/privacy`} className={buttonClass("secondary")}><Download size={14} aria-hidden />Download data (JSON)</a>
    </Card>
    {canErase && <Card title="Erase permanently" description="For deletion requests. Removes the talent, every related record, stored photos, videos and documents, and applications that became this talent. Bookings keep their history without this person.">
      <form onSubmit={erase} className="space-y-3">
        <TextField label={`Type “${name}” to confirm`} name="confirm" value={confirm} onChange={setConfirm} />
        <Button type="submit" variant="danger" icon={<Trash2 size={14} />} disabled={pending || confirm !== name}>Erase {name}</Button>
      </form>
    </Card>}
  </div>;
}
