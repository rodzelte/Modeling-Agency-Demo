import Link from "next/link";
import { Download } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { ErrorState, UnauthorizedState } from "@/components/ui/States";
import { requirePage } from "@/lib/agency-auth";
import { formatDate } from "@/lib/format";
import { log } from "@/lib/log";
import { financeRows, type FinanceRow } from "@/features/operations/queries";
import { INVOICE_STATUSES, LABELS } from "@/features/operations/schemas";

export const metadata = { title: "Finance" };

type Search = { invoice?: string; from?: string; to?: string };
const money = (value: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
const date = (value: string | undefined) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined);

export default async function FinancePage({ searchParams }: { searchParams: Promise<Search> }) {
  const context = await requirePage("finance.view");
  if (!context) return <UnauthorizedState />;
  const search = await searchParams;
  const filters = { invoice: INVOICE_STATUSES.includes(search.invoice as never) ? search.invoice : undefined, from: date(search.from), to: date(search.to) };
  let rows: FinanceRow[];
  try {
    rows = await financeRows(context.supabase, filters);
  } catch (error) {
    log.error("finance", "rows failed", error);
    return <ErrorState title="Finance data could not be loaded" />;
  }

  // Totals per currency; bookings without fees are counted separately.
  const totals = new Map<string, { fees: number; commission: number; outstanding: number }>();
  for (const row of rows) {
    const f = row.financials;
    if (!f?.fee_total) continue;
    const fee = Number(f.fee_total);
    const entry = totals.get(f.currency) ?? { fees: 0, commission: 0, outstanding: 0 };
    entry.fees += fee;
    entry.commission += fee * (Number(f.commission_pct ?? 0) / 100);
    if (f.invoice_status !== "paid" && f.invoice_status !== "written_off") entry.outstanding += fee;
    totals.set(f.currency, entry);
  }
  const missing = rows.filter((row) => !row.financials?.fee_total).length;
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value) as [string, string][]).toString();
  const fieldClass = "w-full rounded-md border border-[#dcdcd6] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#a4502f]";

  return <div className="space-y-6">
    <PageHeader eyebrow="Administration" title="Finance" description="Fees, commission and invoice status for confirmed and completed bookings."
      actions={<a href={`/api/dashboard/finance/export${query ? `?${query}` : ""}`} className={buttonClass("secondary")}><Download size={14} aria-hidden />Export CSV</a>} />
    <form className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
      <label className="text-[10px] font-800 uppercase tracking-[.14em] text-[#6f716b]">Invoice status<select name="invoice" defaultValue={filters.invoice ?? ""} className={`mt-2 ${fieldClass}`}><option value="">Any</option>{INVOICE_STATUSES.map((status) => <option key={status} value={status}>{LABELS.invoice[status]}</option>)}</select></label>
      <label className="text-[10px] font-800 uppercase tracking-[.14em] text-[#6f716b]">From<input type="date" name="from" defaultValue={filters.from ?? ""} className={`mt-2 ${fieldClass}`} /></label>
      <label className="text-[10px] font-800 uppercase tracking-[.14em] text-[#6f716b]">To<input type="date" name="to" defaultValue={filters.to ?? ""} className={`mt-2 ${fieldClass}`} /></label>
      <button className={buttonClass("primary")}>Filter</button>
    </form>

    <section aria-label="Totals" className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {[...totals.entries()].map(([currency, total]) => [["Billed", total.fees], ["Commission", total.commission], ["Outstanding", total.outstanding]].map(([label, value]) => <div key={`${currency}-${label}`} className="rounded-xl border border-[#e7e7e3] bg-white p-5">
        <p className="text-[10px] font-800 uppercase tracking-[.14em] text-[#6b6d66]">{label} · {currency}</p>
        <p className="mt-2 text-3xl font-700 tabular-nums tracking-[-.03em]">{money(value as number, currency)}</p>
      </div>))}
      {totals.size === 0 && <p className="text-sm text-[#6b6d66] sm:col-span-3">No fees recorded for these bookings yet.</p>}
    </section>
    {missing > 0 && <p className="text-xs text-[#94692c]">{missing} booking{missing === 1 ? " has" : "s have"} no fee recorded.</p>}

    <DataTable<FinanceRow> rows={rows} rowKey={(row) => row.id} caption="Bookings with fees"
      empty={{ title: "No bookings match", body: "Confirmed and completed bookings appear here." }}
      columns={[
        { key: "booking", header: "Booking", cell: (row) => <Link href={`/dashboard/bookings/${row.id}`} className="block"><span className="font-700 hover:text-[#a4502f]">{row.title}</span><span className="block text-[11px] text-[#6b6d66]">{row.reference} · {formatDate(row.start_at)}{row.company ? ` · ${row.company.name}` : ""}</span></Link> },
        { key: "fee", header: "Fee", className: "tabular-nums", cell: (row) => row.financials?.fee_total ? money(Number(row.financials.fee_total), row.financials.currency) : <span className="text-xs text-[#717369]">—</span> },
        { key: "commission", header: "Commission", className: "text-xs tabular-nums", cell: (row) => row.financials?.commission_pct ? `${Number(row.financials.commission_pct)}%` : "—" },
        { key: "invoice", header: "Invoice", cell: (row) => { const status = row.financials?.invoice_status ?? "not_invoiced"; return <span className="flex items-center gap-2"><Badge tone={status === "paid" ? "public" : status === "invoiced" ? "review" : status === "written_off" ? "inactive" : "draft"}>{LABELS.invoice[status as keyof typeof LABELS.invoice]}</Badge>{row.financials?.invoice_number && <span className="text-[11px] text-[#6b6d66]">#{row.financials.invoice_number}</span>}</span>; } },
      ]} />
  </div>;
}
