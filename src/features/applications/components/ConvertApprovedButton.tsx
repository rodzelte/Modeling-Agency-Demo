"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

type BatchResult = { converted: number; failed: number; photos_copied: number; remaining: number };

// Converts every approved application into a draft talent record, calling the
// batch endpoint until none remain. Drafts are private; nothing is published.
export function ConvertApprovedButton({ count }: { count: number }) {
  const router = useRouter();
  const toast = useToast();
  const [progress, setProgress] = useState<string | null>(null);

  async function convertAll() {
    if (!window.confirm(`Create draft talent records for all ${count} approved applications? Details and photos are copied; nothing is published.`)) return;
    let converted = 0;
    let failed = 0;
    let photos = 0;
    setProgress(`Converting… 0 of ${count}`);
    try {
      for (let round = 0; round < 50; round += 1) {
        const response = await fetch("/api/dashboard/applications/convert-approved", { method: "POST" });
        const result = await response.json().catch(() => null) as (BatchResult & { error?: string }) | null;
        if (!response.ok || !result) { toast.error(result?.error ?? "Conversion stopped. Try again."); break; }
        converted += result.converted;
        failed += result.failed;
        photos += result.photos_copied;
        setProgress(`Converting… ${converted} of ${count}`);
        if (!result.remaining || !result.converted) break;
      }
    } catch {
      toast.error("Network error. Check your connection and try again.");
    }
    setProgress(null);
    if (converted) toast.success(`${converted} draft talent record${converted === 1 ? "" : "s"} created, ${photos} photo${photos === 1 ? "" : "s"} copied`);
    if (failed) toast.error(`${failed} could not be converted. Open them to convert one by one.`);
    router.refresh();
  }

  return <Button icon={<UserPlus size={14} />} disabled={progress !== null} onClick={convertAll}>{progress ?? `Convert all approved (${count})`}</Button>;
}
