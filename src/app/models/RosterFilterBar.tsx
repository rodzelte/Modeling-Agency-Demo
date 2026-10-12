"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { activeFilterCount, CM_PER_INCH, rosterQuery, type RosterFilters } from "@/features/public/filters";
import type { PublicBoard } from "@/features/public/types";

type Options = { genders: string[]; hair: string[]; eyes: string[]; skills: string[]; portfolios: string[] };

// 4'10" to 6'8" in one-inch steps; values are centimetres to match the database.
const heights = Array.from({ length: 23 }, (_, index) => {
  const totalInches = 58 + index;
  return { value: Math.round(totalInches * CM_PER_INCH), label: `${Math.floor(totalInches / 12)}' ${totalInches % 12}"` };
});
const waists = Array.from({ length: 21 }, (_, index) => 22 + index);
const hips = Array.from({ length: 21 }, (_, index) => 30 + index);

// URL-driven filters: every change navigates to a shareable /models?... address,
// and the server renders the results. Works without JavaScript via the Apply button.
export function RosterFilterBar({ filters, boards, options }: { filters: RosterFilters; boards: PublicBoard[]; options: Options }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(filters.q ?? "");
  const [open, setOpen] = useState(activeFilterCount(filters) - (filters.q ? 1 : 0) - (filters.board ? 1 : 0) > 0);

  const go = (next: Partial<RosterFilters>) => startTransition(() => {
    router.replace(`${pathname}${rosterQuery(filters, { ...next, page: undefined })}`, { scroll: false });
  });
  const value = (key: keyof RosterFilters) => (filters[key] === undefined ? "" : String(filters[key]));
  const setFrom = (key: keyof RosterFilters) => (event: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => go({ [key]: event.target.value || undefined });

  const top = filters.board?.split("/")[0];
  const roots = boards.filter((board) => board.depth === 0);
  const topBoard = roots.find((board) => board.path === top);
  const children = topBoard ? boards.filter((board) => board.parent_id === topBoard.id) : [];
  const chip = (active: boolean) => `rounded-full border px-4 py-2 text-[10px] font-800 uppercase tracking-[.11em] transition-colors ${active ? "border-[var(--ink)] bg-[var(--ink)] text-white" : "border-[var(--line)] hover:border-[var(--ink)]"}`;
  const boardHref = (board?: string) => `${pathname}${rosterQuery(filters, { board, page: undefined })}`;
  const selectClass = "w-full min-w-0 border-b border-[var(--line)] bg-transparent py-2 text-[13px] outline-none focus:border-[var(--ink)]";
  const labelClass = "block min-w-0 text-[9px] font-800 uppercase tracking-[.16em] text-[var(--muted)]";
  const count = activeFilterCount(filters);

  return <form action={pathname} method="get" role="search" aria-label="Filter the roster" aria-busy={pending}
    onSubmit={(event) => { event.preventDefault(); go({ q: query.trim() || undefined }); }}
    className="mb-10 space-y-5 border-b border-[var(--line)] pb-6">
    {filters.board && <input type="hidden" name="board" value={filters.board} />}
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0 space-y-3">
        <nav className="flex flex-wrap gap-2" aria-label="Filter by board">
          <Link href={boardHref(undefined)} aria-current={!filters.board ? "page" : undefined} className={chip(!filters.board)} scroll={false}>All boards</Link>
          {roots.map((board) => <Link key={board.id} href={boardHref(board.path)} aria-current={top === board.path ? "page" : undefined} className={chip(top === board.path)} scroll={false}>{board.name}</Link>)}
        </nav>
        {children.length > 0 && <nav className="flex flex-wrap gap-2 pl-1" aria-label={`${topBoard?.name} boards`}>
          <Link href={boardHref(topBoard!.path)} aria-current={filters.board === topBoard!.path ? "page" : undefined} className={`${chip(filters.board === topBoard!.path)} !px-3 !py-1.5`} scroll={false}>All {topBoard?.name}</Link>
          {children.map((board) => <Link key={board.id} href={boardHref(board.path)} aria-current={filters.board === board.path ? "page" : undefined} className={`${chip(filters.board === board.path)} !px-3 !py-1.5`} scroll={false}>{board.name.split(" / ").pop()}</Link>)}
        </nav>}
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <label className="flex items-center gap-3 border-b border-[var(--line)] pb-2 text-[11px] text-[var(--muted)]"><Search size={15} aria-hidden /><span className="sr-only">Search by name or location</span>
          <input name="q" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or city" maxLength={60} className="w-36 bg-transparent text-[var(--ink)] outline-none placeholder:text-[var(--muted)] sm:w-44" />
        </label>
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="roster-filters"
          className="flex items-center gap-2 text-[10px] font-800 uppercase tracking-[.14em] hover:opacity-70"><SlidersHorizontal size={14} aria-hidden />Filters{count ? ` (${count})` : ""}</button>
      </div>
    </div>

    <div id="roster-filters" hidden={!open} className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
      <label className={labelClass}>Gender<select name="gender" value={value("gender")} onChange={setFrom("gender")} className={selectClass}><option value="">Any</option>{options.genders.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label className={labelClass}>Min height<select name="heightMin" value={value("heightMin")} onChange={setFrom("heightMin")} className={selectClass}><option value="">Any</option>{heights.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <label className={labelClass}>Max height<select name="heightMax" value={value("heightMax")} onChange={setFrom("heightMax")} className={selectClass}><option value="">Any</option>{heights.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <label className={labelClass}>Min age<input name="ageMin" type="number" inputMode="numeric" min={0} max={99} defaultValue={value("ageMin")} onBlur={setFrom("ageMin")} className={selectClass} /></label>
      <label className={labelClass}>Max age<input name="ageMax" type="number" inputMode="numeric" min={0} max={99} defaultValue={value("ageMax")} onBlur={setFrom("ageMax")} className={selectClass} /></label>
      <label className={labelClass}>Location<input name="location" defaultValue={value("location")} onBlur={setFrom("location")} maxLength={60} placeholder="Any" className={selectClass} /></label>
      <label className={labelClass}>Hair<select name="hair" value={value("hair")} onChange={setFrom("hair")} className={selectClass}><option value="">Any</option>{options.hair.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label className={labelClass}>Eyes<select name="eyes" value={value("eyes")} onChange={setFrom("eyes")} className={selectClass}><option value="">Any</option>{options.eyes.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label className={labelClass}>Waist up to<select name="waistMax" value={value("waistMax")} onChange={setFrom("waistMax")} className={selectClass}><option value="">Any</option>{waists.map((item) => <option key={item} value={item}>{item}&quot;</option>)}</select></label>
      <label className={labelClass}>Hips up to<select name="hipsMax" value={value("hipsMax")} onChange={setFrom("hipsMax")} className={selectClass}><option value="">Any</option>{hips.map((item) => <option key={item} value={item}>{item}&quot;</option>)}</select></label>
      <label className={labelClass}>Skill<select name="skill" value={value("skill")} onChange={setFrom("skill")} className={selectClass}><option value="">Any</option>{options.skills.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label className={labelClass}>Portfolio<select name="portfolio" value={value("portfolio")} onChange={setFrom("portfolio")} className={selectClass}><option value="">Any</option>{options.portfolios.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label className={labelClass}>Sort<select name="sort" value={value("sort") || "featured"} onChange={(event) => go({ sort: event.target.value === "featured" ? undefined : event.target.value as RosterFilters["sort"] })} className={selectClass}><option value="featured">Featured</option><option value="name">Name A–Z</option><option value="newest">Recently updated</option></select></label>
      <div className="col-span-2 flex items-end gap-5 sm:col-span-3 lg:col-span-5">
        <button type="submit" className="border-b border-[var(--ink)] pb-1 text-[10px] font-800 uppercase tracking-[.14em]">Apply</button>
        {count > 0 && <Link href={pathname} scroll={false} onClick={() => setQuery("")} className="flex items-center gap-1 pb-1 text-[10px] font-800 uppercase tracking-[.14em] text-[var(--muted)] hover:text-[var(--ink)]"><X size={12} aria-hidden />Clear all</Link>}
      </div>
    </div>
  </form>;
}
