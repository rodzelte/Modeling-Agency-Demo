"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, RotateCcw, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { useMutation } from "@/lib/use-mutation";

type SyncResult = { done?: boolean; stats?: Record<string, number>; error?: string };

// "Run sync now": calls the reconcile step repeatedly until the run finishes
// (each call works for up to ~45 s), showing progress.
export function RunSyncButton() {
  const router = useRouter();
  const toast = useToast();
  const [progress, setProgress] = useState<string | null>(null);

  async function run() {
    setProgress("Syncing…");
    try {
      for (let round = 1; round <= 40; round += 1) {
        const response = await fetch("/api/dashboard/ghl", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reconcile" }) });
        const result = await response.json().catch(() => null) as SyncResult | null;
        if (!response.ok || !result) { toast.error(result?.error ?? "The sync stopped. Try again."); break; }
        const stats = result.stats ?? {};
        setProgress(`Syncing… ${stats.contacts_synced ?? 0} contacts, ${stats.photos_stored ?? 0} photos`);
        if (result.done) {
          toast.success(`Sync finished: ${stats.contacts_synced ?? 0} contacts updated, ${stats.talents_linked_or_created ?? 0} talent linked or created, ${stats.photos_stored ?? 0} photos`);
          break;
        }
        router.refresh();
      }
    } catch {
      toast.error("Network error. Check your connection and try again.");
    }
    setProgress(null);
    router.refresh();
  }

  return <Button icon={<RefreshCw size={14} />} disabled={progress !== null} onClick={run}>{progress ?? "Run sync now"}</Button>;
}

export function RetryFailedButton({ count }: { count: number }) {
  const { run, pending } = useMutation();
  return <Button variant="secondary" icon={<RotateCcw size={14} />} disabled={pending || count === 0}
    onClick={() => run("/api/dashboard/ghl", { body: { action: "retry" }, success: "Failed records queued again. Run sync now to process them." })}>Retry failed ({count})</Button>;
}

export function SyncContactButton({ contactId, label = "Sync from GHL now" }: { contactId: string; label?: string }) {
  const { run, pending } = useMutation();
  return <Button size="sm" variant="secondary" icon={<RefreshCw size={13} />} disabled={pending}
    onClick={() => run("/api/dashboard/ghl", { body: { action: "contact", contactId }, success: "Synced from GHL" })}>{pending ? "Syncing…" : label}</Button>;
}

export function CreateTalentButton({ contactId, name }: { contactId: string; name: string }) {
  const { run, pending } = useMutation();
  const router = useRouter();
  async function create() {
    if (!window.confirm(`Create a private draft talent record for ${name}? If a matching talent already exists it is linked instead. Nothing is published.`)) return;
    const result = await run<{ talentId?: string }>(`/api/dashboard/ghl/contacts/${contactId}/talent`, { success: "Talent record ready" });
    if (result?.talentId) router.push(`/dashboard/talent/${result.talentId}?tab=crm`);
  }
  return <Button size="sm" variant="secondary" icon={<UserPlus size={13} />} disabled={pending} onClick={create}>Create talent</Button>;
}

export function ConflictActions({ id }: { id: string }) {
  const { run, pending } = useMutation();
  const resolve = (resolution: string, success: string) => run(`/api/dashboard/ghl/conflicts/${id}`, { body: { resolution }, success });
  return <div className="flex flex-wrap gap-1.5">
    <Button size="sm" variant="secondary" disabled={pending} onClick={() => resolve("took_ghl", "Used the GHL value")}>Use GHL</Button>
    <Button size="sm" variant="secondary" disabled={pending} onClick={() => resolve("kept_dashboard", "Kept the dashboard value")}>Keep dashboard</Button>
    <Button size="sm" variant="ghost" disabled={pending} onClick={() => resolve("dismissed", "Dismissed")}>Dismiss</Button>
  </div>;
}
