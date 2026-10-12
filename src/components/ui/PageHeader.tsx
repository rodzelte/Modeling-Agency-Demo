import type { ReactNode } from "react";

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return <header className="flex flex-col gap-5 border-b border-[#e7e7e3] pb-6 md:flex-row md:items-end md:justify-between">
    <div>
      {eyebrow && <p className="text-[10px] font-800 uppercase tracking-[.18em] text-[#a4502f]">{eyebrow}</p>}
      <h1 className="mt-2 text-3xl font-700 tracking-[-.03em]">{title}</h1>
      {description && <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6b6d66]">{description}</p>}
    </div>
    {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
  </header>;
}

export function Card({ title, description, actions, children, className = "" }: { title?: string; description?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`min-w-0 rounded-xl border border-[#e7e7e3] bg-white ${className}`}>
    {(title || actions) && <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#efefeb] px-5 py-4">
      <div>{title && <h2 className="text-sm font-800">{title}</h2>}{description && <p className="mt-1 text-xs leading-5 text-[#6b6d66]">{description}</p>}</div>
      {actions}
    </div>}
    <div className="p-5">{children}</div>
  </section>;
}
