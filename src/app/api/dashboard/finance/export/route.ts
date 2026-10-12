import { NextResponse } from "next/server";
import { requireApi } from "@/lib/agency-auth";
import { databaseError, writeAudit } from "@/lib/api";
import { financeRows } from "@/features/operations/queries";
import { INVOICE_STATUSES } from "@/features/operations/schemas";
import { csvCell as cell } from "@/features/operations/export";

// CSV for the accountant (formula-safe cells, see csvCell). Every export is audited.

export async function GET(request: Request) {
  const auth = await requireApi("finance.view");
  if ("response" in auth) return auth.response;
  const url = new URL(request.url);
  const date = (value: string | null) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined);
  const invoice = url.searchParams.get("invoice");
  const filters = { invoice: INVOICE_STATUSES.includes(invoice as never) ? invoice as string : undefined, from: date(url.searchParams.get("from")), to: date(url.searchParams.get("to")) };
  let rows: Awaited<ReturnType<typeof financeRows>>;
  try {
    rows = await financeRows(auth.context.supabase, filters);
  } catch (error) {
    return databaseError(error as { message?: string }, "export finance data");
  }
  const header = ["Reference", "Title", "Status", "Start", "End", "Client", "Talent", "Rate", "Fee", "Currency", "Commission %", "Expenses", "Invoice status", "Invoice number", "Invoiced on", "Paid on"];
  const lines = rows.map((row) => [
    row.reference, row.title, row.status, row.start_at, row.end_at, row.company?.name, row.talent.map((item) => item.display_name).join("; "),
    null, row.financials?.fee_total, row.financials?.currency, row.financials?.commission_pct, row.financials?.expenses,
    row.financials?.invoice_status ?? "not_invoiced", row.financials?.invoice_number, row.financials?.invoiced_on, row.financials?.paid_on,
  ].map(cell).join(","));
  await writeAudit(auth.context.supabase, { action: "finance.exported", entityType: "finance", metadata: { rows: rows.length, ...filters } });
  return new NextResponse(`﻿${[header.join(","), ...lines].join("\r\n")}\r\n`, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="42-finance-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "private, no-store" },
  });
}
