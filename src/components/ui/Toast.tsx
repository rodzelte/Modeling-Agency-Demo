"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Check, CircleAlert, X } from "lucide-react";

type Toast = { id: number; tone: "success" | "error"; message: string };
type ToastApi = { success: (message: string) => void; error: (message: string) => void };

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)), []);
  const push = useCallback((tone: Toast["tone"], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current.slice(-3), { id, tone, message }]);
    setTimeout(() => dismiss(id), tone === "error" ? 7000 : 3500);
  }, [dismiss]);
  const api = useMemo<ToastApi>(() => ({ success: (message) => push("success", message), error: (message) => push("error", message) }), [push]);

  return <ToastContext.Provider value={api}>
    {children}
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(360px,calc(100%_-_32px))] flex-col gap-2">
      {toasts.map((toast) => <div key={toast.id} role={toast.tone === "error" ? "alert" : "status"}
        className={`pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 text-xs shadow-lg ${toast.tone === "error" ? "border-[#e6c3b4] bg-[#fdf6f3] text-[#a9593d]" : "border-[#b7cdb9] bg-[#f3f8f3] text-[#4f7a54]"}`}>
        {toast.tone === "error" ? <CircleAlert size={15} className="mt-0.5 shrink-0" /> : <Check size={15} className="mt-0.5 shrink-0" />}
        <p className="flex-1 leading-5">{toast.message}</p>
        <button type="button" onClick={() => dismiss(toast.id)} aria-label="Dismiss notification"><X size={14} /></button>
      </div>)}
    </div>
  </ToastContext.Provider>;
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}
