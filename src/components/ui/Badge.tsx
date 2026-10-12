import type { ReactNode } from "react";

const tones = {
  published: "bg-[#e4eee5] text-[#4f7a54]",
  review: "bg-[#f7ecd8] text-[#94692c]",
  draft: "bg-[#efefeb] text-[#6f716b]",
  archived: "bg-[#ecebf3] text-[#6a6789]",
  private: "bg-[#efefeb] text-[#6f716b]",
  public: "bg-[#e4eee5] text-[#4f7a54]",
  internal: "bg-[#f8e8df] text-[#a9593d]",
  inactive: "bg-[#efefeb] text-[#717369]",
  neutral: "bg-[#efefeb] text-[#5f615b]",
} as const;

export type BadgeTone = keyof typeof tones;

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[9px] font-800 uppercase tracking-[.12em] ${tones[tone]}`}>{children}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const tone = (status in tones ? status : "neutral") as BadgeTone;
  return <Badge tone={tone}>{status}</Badge>;
}
