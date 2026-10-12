import Link from "next/link";

const LINKS = [
  { href: "/dashboard/ghl", label: "Overview" },
  { href: "/dashboard/ghl/contacts", label: "Contacts" },
  { href: "/dashboard/ghl/mapping", label: "Mapping" },
];

export function GhlNav({ active }: { active: string }) {
  return <nav aria-label="GHL Sync sections" className="flex flex-wrap gap-1.5">
    {LINKS.map((link) => <Link key={link.href} href={link.href} aria-current={active === link.href ? "page" : undefined}
      className={`rounded-full px-3 py-1.5 text-[10px] font-800 uppercase tracking-[.12em] ${active === link.href ? "bg-[#20211f] text-white" : "bg-white text-[#5f615b] ring-1 ring-[#e7e7e3] hover:ring-[#20211f]"}`}>{link.label}</Link>)}
  </nav>;
}
