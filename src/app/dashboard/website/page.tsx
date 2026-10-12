import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PageHeader } from "@/components/ui/PageHeader";
import { ErrorState, UnauthorizedState } from "@/components/ui/States";
import { requirePage } from "@/lib/agency-auth";
import { log } from "@/lib/log";
import { SETTINGS_DEFAULTS, listEditorPages } from "@/features/cms/queries";
import { MediaPanel, NavigationPanel, PagesPanel, RedirectsPanel, SettingsPanel, type SettingsValue } from "@/features/cms/components/WebsitePanels";

export const metadata = { title: "Website" };

const TABS = [
  { key: "pages", label: "Pages" },
  { key: "navigation", label: "Navigation" },
  { key: "settings", label: "Site settings" },
  { key: "media", label: "Media" },
  { key: "redirects", label: "Redirects" },
] as const;
type Tab = (typeof TABS)[number]["key"];

async function loadTab(supabase: SupabaseClient, tab: Tab) {
  if (tab === "pages") return { tab, pages: await listEditorPages(supabase) } as const;
  if (tab === "navigation") {
    const [items, pages] = await Promise.all([
      supabase.from("website_navigation").select("id,location,label,href,is_visible").order("location").order("sort_order"),
      listEditorPages(supabase),
    ]);
    if (items.error) throw items.error;
    return { tab, items: items.data, pages } as const;
  }
  if (tab === "settings") {
    const { data, error } = await supabase.from("website_settings").select("key,value");
    if (error) throw error;
    const stored = Object.fromEntries((data ?? []).map((row: { key: string; value: unknown }) => [row.key, row.value]));
    const settings = {
      ...SETTINGS_DEFAULTS,
      ...Object.fromEntries(Object.entries(stored).filter(([key]) => key in SETTINGS_DEFAULTS)),
      home_hero: { ...SETTINGS_DEFAULTS.home_hero, ...(stored.home_hero as object ?? {}) },
      home_about: { ...SETTINGS_DEFAULTS.home_about, ...(stored.home_about as object ?? {}) },
    } as SettingsValue;
    return { tab, settings } as const;
  }
  if (tab === "redirects") {
    const { data, error } = await supabase.from("website_redirects").select("id,from_path,to_path,permanent,is_active,hits").order("from_path");
    if (error) throw error;
    return { tab, redirects: data } as const;
  }
  return { tab: "media" } as const;
}

export default async function WebsitePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const context = await requirePage("website.manage");
  if (!context) return <UnauthorizedState />;
  const requested = (await searchParams).tab;
  const tab = TABS.find((item) => item.key === requested)?.key ?? "pages";

  let data: Awaited<ReturnType<typeof loadTab>> | null = null;
  try {
    data = await loadTab(context.supabase, tab);
  } catch (error) {
    log.error("cms", "website tab failed", error, { tab });
  }

  return <div className="space-y-6">
    <PageHeader eyebrow="Website" title="Website content" description="Edit pages, menus and home-page content without code. Changes stay private until you publish them." />
    <nav aria-label="Website sections" className="flex flex-wrap gap-1.5 border-b border-[#e7e7e3] pb-3">
      {TABS.map((item) => <Link key={item.key} href={`/dashboard/website?tab=${item.key}`} aria-current={tab === item.key ? "page" : undefined}
        className={`rounded-full px-3 py-1.5 text-[10px] font-800 uppercase tracking-[.12em] ${tab === item.key ? "bg-[#20211f] text-white" : "bg-white text-[#5f615b] ring-1 ring-[#e7e7e3] hover:ring-[#20211f]"}`}>{item.label}</Link>)}
    </nav>
    {!data ? <ErrorState title="This section could not be loaded" />
      : data.tab === "pages" ? <PagesPanel pages={data.pages} />
      : data.tab === "navigation" ? <NavigationPanel items={data.items} pages={data.pages} />
      : data.tab === "settings" ? <SettingsPanel settings={data.settings} />
      : data.tab === "redirects" ? <RedirectsPanel redirects={data.redirects} />
      : <MediaPanel />}
  </div>;
}
