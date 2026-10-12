"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

// Origins allowed to hand data to this page (the owner's own CDS / WebForFashion
// windows, opened from here). Everything is validated again on the server.
const SOURCES = new Set(["https://app.webforfashion.com", "https://go.cdsglobal.com"]);
const WINDOWS = {
  cds: { url: "https://go.cdsglobal.com/Talent.aspx", name: "cds-source", label: "CDS" },
  wff: { url: "https://app.webforfashion.com/talent/search", name: "wff-source", label: "WebForFashion" },
};

type Line = { at: string; text: string; tone: "ok" | "error" | "info" };

// Steps 1 and 2 receive data from CDS and WebForFashion windows opened from here,
// by postMessage (no files are downloaded): { type: "cds-import/batch",
// requestId, payload: { talents?, wff? } } — the body of /api/dashboard/cds/ingest.
// Step 3 adds the talents not yet in the dashboard. Step 4 (photos) runs from the
// WebForFashion window too: { plan | photos | finish } go to /api/dashboard/cds/photos.
export function CdsImportPanel({ pending }: { pending: number }) {
  const router = useRouter();
  const toast = useToast();
  const [lines, setLines] = useState<Line[]>([]);
  const [received, setReceived] = useState(0);
  const [applying, setApplying] = useState(false);
  const queue = useRef(Promise.resolve());

  const note = (text: string, tone: Line["tone"] = "info") =>
    setLines((current) => [{ at: new Date().toLocaleTimeString(), text, tone }, ...current].slice(0, 200));

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!SOURCES.has(event.origin) || typeof event.data !== "object" || !event.data) return;
      const reply = (message: Record<string, unknown>) => (event.source as Window | null)?.postMessage(message, event.origin);
      if (event.data.type === "cds-import/hello") { reply({ type: "cds-import/ready" }); return; }
      if (event.data.type !== "cds-import/batch" || typeof event.data.payload !== "object" || !event.data.payload) return;
      const payload = event.data.payload as { talents?: { first_name?: string; last_name?: string }[]; wff?: { first_name?: string; last_name?: string }[]; plan?: true; photos?: unknown[]; finish?: string; name?: string };
      const talents = [...(payload.talents ?? []), ...(payload.wff ?? [])];
      const requestId = event.data.requestId;
      // Photo copy (step 4): plan, copy a few photos, or finish one talent.
      if (payload.plan || payload.photos || payload.finish) {
        queue.current = queue.current.then(async () => {
          const body = payload.plan ? { plan: true } : payload.photos ? { photos: payload.photos } : { finish: payload.finish };
          const response = await fetch("/api/dashboard/cds/photos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
          const result = response ? await response.json().catch(() => ({})) : { error: "Network error" };
          if (!response?.ok) note(`Photo copy: ${result.error ?? "error"}`, "error");
          else if (payload.plan) note(`Photo copy: ${result.selected} photos selected for ${result.talents.length} talents; ${result.imported} already copied`, "ok");
          else if (payload.photos) {
            setReceived((count) => count + (result.imported ?? 0));
            if (result.failed) note(`Photo copy: ${result.failed} could not be copied (${(result.errors ?? []).slice(0, 2).join("; ")})`, "error");
          } else note(`Photos ready for ${payload.name ?? payload.finish}: ${result.cover ? "profile picture set, " : ""}${result.portfolios} portfolios`, "ok");
          reply({ type: "cds-import/ack", requestId, ok: Boolean(response?.ok), error: response?.ok ? null : result.error ?? "error", result });
        });
        return;
      }
      // One batch at a time, in arrival order.
      queue.current = queue.current.then(async () => {
        const response = await fetch("/api/dashboard/cds/ingest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).catch(() => null);
        const result = response ? await response.json().catch(() => ({})) : { error: "Network error" };
        const names = talents.map((t) => `${t.first_name ?? ""} ${t.last_name ?? ""}`.trim()).join(", ");
        if (response?.ok) {
          setReceived((count) => count + talents.length);
          note(`Saved ${names}${payload.wff ? ` (${result.media ?? 0} photos listed)` : ""}`, "ok");
          if (result.unmatched?.length) note(`No CDS record found for ${result.unmatched.join(", ")}; read CDS first`, "error");
        } else note(`Could not save ${names}: ${result.error ?? "error"}`, "error");
        reply({ type: "cds-import/ack", requestId, ok: Boolean(response?.ok), error: response?.ok ? null : result.error ?? "error", unmatched: result.unmatched ?? [] });
      });
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  function open(source: keyof typeof WINDOWS) {
    const target = WINDOWS[source];
    // Demo mode never opens the real CDS: the sample staging data stands in for it.
    if (process.env.NEXT_PUBLIC_DEMO_MODE === "true") {
      note(`Demo mode: ${target.label} is not opened. The sample talents listed on this page stand in for what it would read; continue with step 3.`, "ok");
      return;
    }
    const opened = window.open(target.url, target.name);
    if (!opened) toast.error(`The browser blocked the ${target.label} window. Allow pop-ups for this site and try again.`);
    else note(`${target.label} window opened. Keep this page open while it reads the talents.`);
  }

  async function addNewTalents() {
    setApplying(true);
    let totals = { matched: 0, created: 0, review: 0, boardsCreated: 0 };
    try {
      for (let round = 0; round < 100; round += 1) {
        const response = await fetch("/api/dashboard/cds/apply", { method: "POST" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) { toast.error(payload.error ?? "The import stopped. Try again."); break; }
        totals = { matched: totals.matched + payload.matched, created: totals.created + payload.created, review: totals.review + payload.review, boardsCreated: totals.boardsCreated + payload.boardsCreated };
        note(`Added ${payload.created}, already in dashboard ${payload.matched}, to review ${payload.review}${payload.repaired ? `, completed ${payload.repaired}` : ""}; ${payload.remaining} left`, "ok");
        if (!payload.remaining) break;
      }
      toast.success(`${totals.created} new talents added as drafts; ${totals.matched} were already in the dashboard${totals.review ? `; ${totals.review} need review` : ""}.`);
    } finally {
      setApplying(false);
      router.refresh();
    }
  }

  return <div className="space-y-4">
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => open("cds")}><ExternalLink size={14} /> 1. Open CDS</Button>
      <Button onClick={() => open("wff")}><ExternalLink size={14} /> 2. Open WebForFashion</Button>
      <Button variant="secondary" onClick={addNewTalents} disabled={applying}><UserPlus size={14} /> {applying ? "Adding…" : `3. Add new talents${pending ? ` (${pending} ready)` : ""}`}</Button>
      {received > 0 && <Button variant="ghost" onClick={() => router.refresh()}>Refresh totals ({received} received)</Button>}
    </div>
    {lines.length > 0 && <ol className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-[#efefeb] bg-[#fafaf8] p-3 font-mono text-[11px]" aria-live="polite">
      {lines.map((line, index) => <li key={index} className={line.tone === "error" ? "text-[#a9593d]" : line.tone === "ok" ? "text-[#3f6b45]" : "text-[#6b6d66]"}>{line.at} · {line.text}</li>)}
    </ol>}
  </div>;
}
