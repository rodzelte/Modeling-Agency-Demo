import type { ReactNode } from "react";
import { EmptyState } from "./States";

export type Column<Row> = { key: string; header: string; cell: (row: Row) => ReactNode; className?: string; headerClassName?: string };

export function DataTable<Row>({ rows, columns, rowKey, empty, caption }: { rows: Row[]; columns: Column<Row>[]; rowKey: (row: Row) => string; empty: { title: string; body?: ReactNode }; caption?: string }) {
  if (!rows.length) return <EmptyState title={empty.title}>{empty.body}</EmptyState>;
  return <div className="relative overflow-x-auto rounded-xl border border-[#e7e7e3] bg-white">
    <table className="w-full min-w-[640px] border-collapse text-left text-sm">
      {caption && <caption className="sr-only">{caption}</caption>}
      <thead><tr className="border-b border-[#efefeb] text-[9px] font-800 uppercase tracking-[.14em] text-[#6b6d66]">
        {columns.map((column) => <th key={column.key} scope="col" className={`px-4 py-3 font-800 ${column.headerClassName ?? ""}`}>{column.header}</th>)}
      </tr></thead>
      <tbody>{rows.map((row) => <tr key={rowKey(row)} className="border-b border-[#f3f3f0] last:border-0 hover:bg-[#fafaf8]">
        {columns.map((column) => <td key={column.key} className={`px-4 py-3 align-middle ${column.className ?? ""}`}>{column.cell(row)}</td>)}
      </tr>)}</tbody>
    </table>
  </div>;
}
