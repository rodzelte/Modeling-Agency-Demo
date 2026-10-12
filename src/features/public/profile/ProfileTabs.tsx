"use client";

import { useEffect, useState } from "react";

// Sticky section tabs. The tab for the section currently in view is underlined.
export function ProfileTabs({ tabs }: { tabs: { id: string; label: string }[] }) {
  const [active, setActive] = useState(tabs[0]?.id ?? "");

  useEffect(() => {
    const sections = tabs.map((tab) => document.getElementById(tab.id)).filter((element): element is HTMLElement => Boolean(element));
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActive(visible[0].target.id);
    }, { rootMargin: "-30% 0px -60% 0px" });
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [tabs]);

  return <nav aria-label="Profile sections" className="sticky top-0 z-20 border-b border-[var(--line)] bg-[var(--paper)]/95 backdrop-blur">
    <div className="no-scrollbar container flex justify-start gap-7 overflow-x-auto sm:gap-12 md:justify-center md:gap-16">
      {tabs.map((tab) => <a key={tab.id} href={`#${tab.id}`} aria-current={active === tab.id ? "true" : undefined}
        className={`label shrink-0 border-b py-5 transition-colors ${active === tab.id ? "border-[var(--ink)] text-[var(--ink)]" : "border-transparent text-[var(--muted)] hover:text-[var(--ink)]"}`}>{tab.label}</a>)}
    </div>
  </nav>;
}
