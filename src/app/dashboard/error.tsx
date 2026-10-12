"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/States";

// Catches rendering errors inside the dashboard so one broken section never blanks
// the whole workspace. Details go to the console, not the screen.
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  useEffect(() => {
    console.error("[dashboard] render error", error.digest ?? "", error.message);
  }, [error]);

  return <div className="space-y-4">
    <ErrorState title="This page could not be displayed">Something went wrong while loading this part of the workspace. Try again, or return to the dashboard.</ErrorState>
    <div className="flex justify-center gap-2"><Button variant="secondary" onClick={reset}>Try again</Button><Button variant="ghost" onClick={() => router.push("/dashboard")}>Dashboard home</Button></div>
  </div>;
}
