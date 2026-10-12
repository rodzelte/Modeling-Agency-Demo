"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { SelectField, TextareaField, TextField } from "@/components/ui/Field";
import { Card } from "@/components/ui/PageHeader";
import { useMutation } from "@/lib/use-mutation";
import { INVOICE_STATUSES, LABELS, RATE_TYPES } from "../schemas";

type Financials = Record<string, unknown> | null;
const text = (value: unknown) => (value === null || value === undefined ? "" : String(value));

export function FinancialsForm({ bookingId, financials, talent, talentFees, canEdit }: {
  bookingId: string; financials: Financials; talent: { id: string; display_name: string }[];
  talentFees: { talent_id: string; fee: string | null; paid_to_talent_on: string | null }[]; canEdit: boolean;
}) {
  const { run, pending } = useMutation();
  const [value, setValue] = useState({
    rate_type: text(financials?.rate_type), fee_total: text(financials?.fee_total), currency: text(financials?.currency) || "USD",
    commission_pct: text(financials?.commission_pct), expenses: text(financials?.expenses), invoice_status: text(financials?.invoice_status) || "not_invoiced",
    invoice_number: text(financials?.invoice_number), invoiced_on: text(financials?.invoiced_on), paid_on: text(financials?.paid_on), notes: text(financials?.notes),
  });
  const [fees, setFees] = useState(talent.map((item) => {
    const existing = talentFees.find((fee) => fee.talent_id === item.id);
    return { talent_id: item.id, fee: text(existing?.fee), paid_to_talent_on: text(existing?.paid_to_talent_on) };
  }));
  const set = (key: keyof typeof value) => (next: string) => setValue({ ...value, [key]: next });
  const fee = Number(value.fee_total) || 0;
  const commission = fee * ((Number(value.commission_pct) || 0) / 100);

  return <Card title="Fees & invoicing" description="Visible to finance roles only. Changes are logged without amounts.">
    <fieldset disabled={!canEdit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SelectField label="Rate" name="rate_type" value={value.rate_type} onChange={set("rate_type")} options={RATE_TYPES.map((rate) => ({ value: rate, label: LABELS.rate[rate] }))} placeholder="—" />
        <TextField label="Total fee" name="fee_total" type="number" min={0} step="0.01" value={value.fee_total} onChange={set("fee_total")} />
        <TextField label="Currency" name="currency" value={value.currency} onChange={(next) => set("currency")(next.toUpperCase().slice(0, 3))} />
        <TextField label="Commission %" name="commission_pct" type="number" min={0} max={100} step="0.1" value={value.commission_pct} onChange={set("commission_pct")} hint={fee ? `≈ ${commission.toFixed(2)} ${value.currency}` : undefined} />
        <TextField label="Expenses" name="expenses" type="number" min={0} step="0.01" value={value.expenses} onChange={set("expenses")} />
        <SelectField label="Invoice status" name="invoice_status" value={value.invoice_status} onChange={set("invoice_status")} options={INVOICE_STATUSES.map((status) => ({ value: status, label: LABELS.invoice[status] }))} />
        <TextField label="Invoice number" name="invoice_number" value={value.invoice_number} onChange={set("invoice_number")} />
        <TextField label="Invoiced on" name="invoiced_on" type="date" value={value.invoiced_on} onChange={set("invoiced_on")} />
        <TextField label="Paid on" name="paid_on" type="date" value={value.paid_on} onChange={set("paid_on")} />
        <TextareaField label="Finance notes" name="notes" rows={2} className="sm:col-span-3" value={value.notes} onChange={set("notes")} />
      </div>
      {talent.length > 0 && <div>
        <p className="text-[10px] font-800 uppercase tracking-[.14em] text-[#6f716b]">Talent fees</p>
        <ul className="mt-2 space-y-2">{fees.map((row, index) => <li key={row.talent_id} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_140px_160px]">
          <span className="text-sm font-700">{talent.find((item) => item.id === row.talent_id)?.display_name}</span>
          <TextField label="Fee" name={`fee-${row.talent_id}`} type="number" min={0} step="0.01" value={row.fee} onChange={(next) => setFees(fees.map((item, i) => i === index ? { ...item, fee: next } : item))} />
          <TextField label="Paid to talent" name={`paid-${row.talent_id}`} type="date" value={row.paid_to_talent_on} onChange={(next) => setFees(fees.map((item, i) => i === index ? { ...item, paid_to_talent_on: next } : item))} />
        </li>)}</ul>
      </div>}
    </fieldset>
    {canEdit && <div className="mt-4 flex justify-end"><Button disabled={pending} onClick={() => run(`/api/dashboard/bookings/${bookingId}/financials`, { method: "PUT", body: { ...value, talent_fees: fees }, success: "Fees saved" })}>{pending ? "Saving…" : "Save fees"}</Button></div>}
  </Card>;
}
