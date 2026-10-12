"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { Card } from "@/components/ui/PageHeader";
import { formatDate, formatDateTime } from "@/lib/format";
import { useMutation } from "@/lib/use-mutation";

export type ChangeRequest = { id: string; talent_id: string; field_group: string; changes: Record<string, unknown>; message: string | null; created_at: string; talent?: { display_name: string } | null };
const GROUPS: Record<string, string> = { contact: "Contact details", address: "Address", measurements: "Measurements", social: "Instagram" };
const cmToIn = (value: unknown) => typeof value === "number" ? `${value} cm (${(value / 2.54).toFixed(1)}")` : String(value);

export function PortalAccessCard({ talentId, access, canEdit }: { talentId: string; access: { email: string; status: string; signed_up: boolean } | null; canEdit: boolean }) {
  const { run, pending } = useMutation();
  const [email, setEmail] = useState("");
  return <Card title="Portal access" description="Talent sign in at /portal/login with a one-time email link. They see only their own profile, confirmed bookings and shared documents.">
    {access ? <div className="flex flex-wrap items-center gap-3 text-sm">
      <span className="font-700">{access.email}</span>
      {access.status !== "active" ? <Badge tone="inactive">Revoked</Badge> : access.signed_up ? <Badge tone="public">Active</Badge> : <Badge tone="review">Invited · not signed in yet</Badge>}
      {canEdit && access.status === "active" && <Button size="sm" variant="ghost" disabled={pending} onClick={() => window.confirm("Revoke portal access? The talent is signed out of the portal.") && run(`/api/dashboard/talents/${talentId}/portal`, { method: "DELETE", success: "Portal access revoked" })}>Revoke</Button>}
    </div> : <p className="text-sm text-[#6b6d66]">Not invited yet.</p>}
    {canEdit && <form className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={async (event) => { event.preventDefault(); if (await run(`/api/dashboard/talents/${talentId}/portal`, { body: { email }, success: "Invited. Tell the talent to sign in at /portal/login." })) setEmail(""); }}>
      <TextField label={access ? "Change or restore email" : "Talent's email"} name="email" type="email" required value={email} onChange={setEmail} className="sm:w-80" />
      <Button type="submit" disabled={pending}>{access ? "Update access" : "Invite to portal"}</Button>
    </form>}
  </Card>;
}

export function ChangeRequestList({ requests, showTalent = false }: { requests: ChangeRequest[]; showTalent?: boolean }) {
  const { run, pending } = useMutation();
  if (!requests.length) return <p className="text-sm text-[#6b6d66]">No pending requests.</p>;
  return <ul className="divide-y divide-[#f3f3f0]">{requests.map((request) => <li key={request.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
    <div className="min-w-0">
      <p className="text-sm font-700">{showTalent && request.talent ? <><Link href={`/dashboard/talent/${request.talent_id}?tab=portal`} className="hover:text-[#a4502f]">{request.talent.display_name}</Link> · </> : null}{GROUPS[request.field_group] ?? request.field_group}</p>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 text-xs">{Object.entries(request.changes).map(([key, value]) => <div key={key} className="contents"><dt className="text-[#6b6d66]">{key.replace(/_/g, " ")}</dt><dd className="font-700">{key.endsWith("_cm") ? cmToIn(value) : String(value)}</dd></div>)}</dl>
      {request.message && <p className="mt-1 text-xs italic text-[#5f615b]">“{request.message}”</p>}
      <p className="mt-1 text-[11px] text-[#6b6d66]">{formatDateTime(request.created_at)}</p>
    </div>
    <div className="flex gap-1.5">
      <Button size="sm" variant="success" icon={<Check size={13} />} disabled={pending} onClick={() => run(`/api/dashboard/change-requests/${request.id}`, { body: { approve: true }, success: "Change approved and saved" })}>Approve</Button>
      <Button size="sm" variant="ghost" icon={<X size={13} />} disabled={pending} onClick={() => { const note = window.prompt("Reason for the talent (optional)") ?? undefined; void run(`/api/dashboard/change-requests/${request.id}`, { body: { approve: false, note }, success: "Request rejected" }); }}>Reject</Button>
    </div>
  </li>)}</ul>;
}

export function AvailabilityList({ items }: { items: { id: string; kind: string; start_on: string; end_on: string; note: string | null }[] }) {
  if (!items.length) return <p className="text-sm text-[#6b6d66]">No upcoming dates from the talent.</p>;
  const labels: Record<string, string> = { unavailable: "Not available", holiday: "Holiday", available: "Extra availability" };
  return <ul className="space-y-1.5 text-sm">{items.map((item) => <li key={item.id}><span className="font-700">{labels[item.kind]}</span> · {formatDate(item.start_on)}{item.end_on !== item.start_on ? ` – ${formatDate(item.end_on)}` : ""}{item.note && <span className="text-[#6b6d66]"> · {item.note}</span>}</li>)}</ul>;
}
