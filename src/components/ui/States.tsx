import type { ReactNode } from "react";
import { Ban, CircleAlert, Inbox, LoaderCircle } from "lucide-react";

function StateFrame({ icon, title, children, tone = "neutral" }: { icon: ReactNode; title: string; children?: ReactNode; tone?: "neutral" | "error" }) {
  return <div role={tone === "error" ? "alert" : "status"} className={`flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-14 text-center ${tone === "error" ? "border-[#e6c3b4] bg-[#fdf6f3]" : "border-[#dcdcd6] bg-white/60"}`}>
    <span className={tone === "error" ? "text-[#a9593d]" : "text-[#717369]"}>{icon}</span>
    <p className="mt-4 text-sm font-800">{title}</p>
    {children && <div className="mt-2 max-w-md text-xs leading-5 text-[#6b6d66]">{children}</div>}
  </div>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return <StateFrame icon={<Inbox size={22} />} title={title}>{children}</StateFrame>;
}

export function ErrorState({ title = "Something went wrong", children }: { title?: string; children?: ReactNode }) {
  return <StateFrame icon={<CircleAlert size={22} />} title={title} tone="error">{children ?? "Please refresh the page. If the problem continues, contact an administrator."}</StateFrame>;
}

export function UnauthorizedState({ children }: { children?: ReactNode }) {
  return <StateFrame icon={<Ban size={22} />} title="You don't have access to this area">{children ?? "Your role does not include this permission. Ask the owner if you need access."}</StateFrame>;
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return <div role="status" className="flex items-center justify-center gap-3 py-16 text-xs text-[#6b6d66]"><LoaderCircle size={16} className="animate-spin" />{label}</div>;
}
