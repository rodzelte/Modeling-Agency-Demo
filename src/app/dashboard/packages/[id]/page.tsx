import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { ErrorState, UnauthorizedState } from "@/components/ui/States";
import { requirePage } from "@/lib/agency-auth";
import { log } from "@/lib/log";
import { companyOptions, talentOptions } from "@/features/operations/queries";
import { PackageEditor, type PackageData } from "@/features/packages/PackageEditor";

export const metadata = { title: "Package" };

export default async function PackagePage({ params }: { params: Promise<{ id: string }> }) {
  const context = await requirePage("packages.manage");
  if (!context) return <UnauthorizedState />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase } = context;
  const [pkg, items, talent, options] = await Promise.all([
    supabase.from("packages").select("id,title,message,company_id,contact_id,show_measurements,shared_at,expires_at,revoked_at,view_count,last_viewed_at,share_token_hash").eq("id", id).maybeSingle(),
    supabase.from("package_items").select("talent_id,note").eq("package_id", id).order("sort_order"),
    talentOptions(supabase),
    companyOptions(supabase),
  ]);
  if (pkg.error || items.error) {
    log.error("packages", "load failed", pkg.error ?? items.error);
    return <ErrorState title="This package could not be loaded" />;
  }
  if (!pkg.data) notFound();
  const { share_token_hash: hash, ...rest } = pkg.data;
  const data: PackageData = { ...rest, has_link: Boolean(hash), items: items.data ?? [] };

  return <div className="space-y-6">
    <Link href="/dashboard/packages" className="inline-flex items-center gap-2 text-xs text-[#6b6d66] hover:text-[#20211f]"><ArrowLeft size={14} aria-hidden />All packages</Link>
    <PageHeader eyebrow="Package" title={data.title} />
    <PackageEditor pkg={data} talent={talent} companies={options.companies} contacts={options.contacts} />
  </div>;
}
