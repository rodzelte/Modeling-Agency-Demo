"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";

type Options = { method?: "POST" | "PATCH" | "PUT" | "DELETE"; body?: unknown; success?: string; refresh?: boolean };

// Calls a dashboard API route, reports the outcome as a toast, and refreshes the
// server-rendered page so it shows the saved state.
export function useMutation() {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);

  const run = useCallback(async <T = Record<string, unknown>>(url: string, { method = "POST", body, success, refresh = true }: Options = {}): Promise<T | null> => {
    setPending(true);
    try {
      const response = await fetch(url, {
        method,
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const payload = response.status === 204 ? null : await response.json().catch(() => null);
      if (!response.ok) {
        toast.error(payload?.error ?? "The change could not be saved.");
        return null;
      }
      if (success) toast.success(success);
      if (refresh) router.refresh();
      return (payload ?? {}) as T;
    } catch {
      toast.error("Network error. Check your connection and try again.");
      return null;
    } finally {
      setPending(false);
    }
  }, [router, toast]);

  return { run, pending };
}
