"use client";

import { CheckboxField, SelectField, TextareaField, TextField } from "@/components/ui/Field";
import type { ColumnFormat, FieldDef } from "../fields";
import { formatDate, formatDateTime, heightLabel, lengthLabel } from "@/lib/format";

type Value = string | number | boolean | null | undefined;

// datetime-local inputs need "YYYY-MM-DDTHH:mm" in local time.
function toLocalInput(value: Value) {
  if (!value || typeof value !== "string") return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function FieldInput({ field, value, disabled }: { field: FieldDef; value: Value; disabled?: boolean }) {
  const common = { label: field.label, name: field.name, hint: field.hint, disabled, className: field.wide ? "sm:col-span-2" : "" };
  switch (field.type) {
    case "checkbox":
      return <CheckboxField {...common} defaultChecked={Boolean(value)} />;
    case "select":
      return <SelectField {...common} required={field.required} options={field.options ?? []} placeholder="—" defaultValue={value === null || value === undefined ? "" : String(value)} />;
    case "textarea":
      return <TextareaField {...common} required={field.required} defaultValue={value === null || value === undefined ? "" : String(value)} />;
    case "datetime-local":
      return <TextField {...common} type="datetime-local" required={field.required} defaultValue={toLocalInput(value)} />;
    default:
      return <ListAwareText field={field} value={value} common={common} />;
  }
}

function ListAwareText({ field, value, common }: { field: FieldDef; value: Value; common: Parameters<typeof TextField>[0] }) {
  // TextField has no list attribute; datalist-backed inputs render their own input.
  if (field.list) {
    return <label className={`block text-[10px] font-800 uppercase tracking-[.14em] text-[#6f716b] ${common.className}`}>{field.label}{field.required && <span className="text-[#a4502f]"> *</span>}
      <input name={field.name} list={field.list} required={field.required} disabled={common.disabled} defaultValue={value === null || value === undefined ? "" : String(value)}
        className="mt-2 w-full rounded-md border border-[#dcdcd6] bg-white px-3 py-2.5 text-sm font-400 normal-case tracking-normal outline-none focus:border-[#a4502f]" />
      {field.hint && <span className="mt-1.5 block text-[11px] font-400 normal-case tracking-normal text-[#6b6d66]">{field.hint}</span>}
    </label>;
  }
  return <TextField {...common} type={field.type ?? "text"} required={field.required} step={field.type === "number" ? "any" : undefined} min={field.type === "number" ? 0 : undefined}
    defaultValue={value === null || value === undefined ? "" : typeof value === "boolean" ? String(value) : value} />;
}

export function formatCell(value: unknown, format: ColumnFormat = "text") {
  if (value === null || value === undefined || value === "") return <span className="text-[#717369]">—</span>;
  switch (format) {
    case "date": return formatDate(String(value));
    case "datetime": return formatDateTime(String(value));
    case "bool": return value ? "Yes" : <span className="text-[#717369]">No</span>;
    case "height": return heightLabel(Number(value));
    case "length": return lengthLabel(Number(value));
    case "number": return Number(value).toLocaleString("en-US");
    case "money": return Number(value).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    default: return <span className="line-clamp-2">{String(value)}</span>;
  }
}
