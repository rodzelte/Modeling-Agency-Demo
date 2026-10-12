"use client";

import { useId, useState } from "react";
import { Eye, EyeOff, KeyRound, Pencil, Trash2, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { SelectField, TextField } from "@/components/ui/Field";
import { readForm } from "@/lib/read-form";
import { useMutation } from "@/lib/use-mutation";
import { formatDate } from "@/lib/format";

export type Member = { id: string; email: string; full_name: string; role: string; status: string; user_id: string | null; created_at: string };

export const ROLE_OPTIONS = [
  { value: "administrator", label: "Administrator" },
  { value: "talent_manager", label: "Talent manager" },
  { value: "booker", label: "Booker" },
  { value: "creative", label: "Creative / photographer" },
  { value: "accounting", label: "Accounting" },
  { value: "staff", label: "Staff" },
  { value: "read_only", label: "Read only" },
];
const STATUS_OPTIONS = [{ value: "active", label: "Active" }, { value: "pending", label: "Pending" }, { value: "suspended", label: "Suspended" }];
const roleLabel = (role: string) => ROLE_OPTIONS.find((option) => option.value === role)?.label ?? role.replace("_", " ");

// Owner-only: approving an email is what grants dashboard access. Signing in with
// Google alone grants nothing.
export function TeamPanel({ members }: { members: Member[] }) {
  const { run, pending } = useMutation();
  const [editing, setEditing] = useState<Member | null>(null);
  const [passwordKey, setPasswordKey] = useState(0);

  async function approve(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = readForm(form);
    const saved = await run<{ confirmation_sent?: boolean }>("/api/dashboard/team", {
      body: { email: values.email, fullName: values.fullName, role: values.role, status: "active", password: values.password || undefined },
      success: values.password ? `${values.email} approved. Send them the temporary password privately.` : `${values.email} approved`,
    });
    if (saved) { form.reset(); setPasswordKey((key) => key + 1); }
  }

  async function update(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const values = readForm(event.currentTarget);
    const password = values.password || undefined;
    if (await run("/api/dashboard/team", {
      body: { email: editing.email, fullName: values.fullName, role: values.role, status: values.status, password },
      success: password ? (process.env.NEXT_PUBLIC_DEMO_MODE === "true" ? "Access updated. Demo mode sends no email: the account is ready and can sign in with the temporary password now." : "Access updated. They will get an email to confirm, then sign in with the temporary password.") : "Access updated",
    })) setEditing(null);
  }

  async function removeAccess() {
    if (!editing || !window.confirm(`Remove ${editing.email} from the team? They lose dashboard access immediately. You can approve the email again later.`)) return;
    if (await run(`/api/dashboard/team?id=${editing.id}`, { method: "DELETE", success: `${editing.email} removed` })) setEditing(null);
  }

  return <div className="grid grid-cols-1 gap-6 xl:grid-cols-[340px_1fr]">
    <form onSubmit={approve} className="min-w-0 space-y-4 rounded-xl border border-[#e7e7e3] bg-white p-5">
      <div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f4e3da] text-[#a4502f]"><UserPlus size={17} /></span>
        <div><h2 className="text-sm font-800">Approve an email</h2><p className="text-[11px] text-[#6b6d66]">They sign in with Google, or with a temporary password you set.</p></div></div>
      <TextField label="Work email" name="email" type="email" required autoComplete="off" />
      <TextField label="Full name" name="fullName" />
      <SelectField label="Role" name="role" defaultValue="read_only" options={ROLE_OPTIONS} hint="Start with the least access needed." />
      <TemporaryPassword key={passwordKey} />
      <Button type="submit" disabled={pending} className="w-full">{pending ? "Saving…" : "Approve access"}</Button>
    </form>

    <div className="relative min-w-0 overflow-x-auto rounded-xl border border-[#e7e7e3] bg-white">
      <table className="w-full min-w-[560px] text-left text-sm">
        <caption className="sr-only">Approved accounts</caption>
        <thead><tr className="border-b border-[#efefeb] text-[9px] font-800 uppercase tracking-[.14em] text-[#6b6d66]"><th className="px-4 py-3">Member</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Signed in</th><th className="px-4 py-3"><span className="sr-only">Edit</span></th></tr></thead>
        <tbody>{members.map((member) => <tr key={member.id} className="border-b border-[#f3f3f0] last:border-0">
          <td className="px-4 py-3"><p className="font-700">{member.full_name || member.email.split("@")[0]}</p><p className="text-[11px] text-[#6b6d66]">{member.email}</p></td>
          <td className="px-4 py-3 text-xs">{member.role === "owner" ? <Badge tone="review">Owner</Badge> : roleLabel(member.role)}</td>
          <td className="px-4 py-3"><Badge tone={member.status === "active" ? "public" : member.status === "suspended" ? "internal" : "draft"}>{member.status}</Badge></td>
          <td className="px-4 py-3 text-xs text-[#6b6d66]">{member.user_id ? "Linked" : `Invited ${formatDate(member.created_at)}`}</td>
          <td className="px-4 py-3 text-right">{member.role !== "owner" && <button type="button" onClick={() => setEditing(member)} aria-label={`Edit ${member.email}`} className="rounded p-1.5 text-[#6b6d66] hover:bg-[#efefeb] hover:text-[#20211f]"><Pencil size={13} /></button>}</td>
        </tr>)}</tbody>
      </table>
    </div>

    <Dialog open={Boolean(editing)} onClose={() => setEditing(null)} title="Edit access" description={editing?.email}>
      {editing && <form onSubmit={update} className="space-y-4">
        <TextField label="Full name" name="fullName" defaultValue={editing.full_name} />
        <SelectField label="Role" name="role" defaultValue={editing.role} options={ROLE_OPTIONS} />
        <SelectField label="Status" name="status" defaultValue={editing.status} options={STATUS_OPTIONS} hint="Suspended members lose access immediately." />
        {editing.user_id
          ? <p className="rounded-md bg-[#f3f3f0] px-3 py-2.5 text-[11px] text-[#6b6d66]">This person already has an account. They change their password in My profile, or with “Forgot password” on the sign-in page.</p>
          : <TemporaryPassword />}
        <div className="flex flex-wrap items-center gap-2 border-t border-[#efefeb] pt-4">
          <Button variant="danger" onClick={removeAccess} disabled={pending}><Trash2 size={14} /> Remove</Button>
          <span className="flex-1" />
          <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" disabled={pending}>Save</Button>
        </div>
      </form>}
    </Dialog>
  </div>;
}

// Optional temporary password: the teammate confirms their email, signs in with it,
// and is asked to choose their own straight away.
function TemporaryPassword() {
  const id = useId();
  const [value, setValue] = useState("");
  const [visible, setVisible] = useState(false);

  function generate() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
    const bytes = crypto.getRandomValues(new Uint32Array(14));
    setValue(Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join(""));
    setVisible(true);
  }

  return <div>
    <label htmlFor={id} className="block text-[10px] font-800 uppercase tracking-[.14em] text-[#6f716b]">Temporary password <span className="font-600 normal-case tracking-normal">(optional)</span></label>
    <div className="mt-2 flex gap-2">
      <div className="relative min-w-0 flex-1">
        <input id={id} name="password" type={visible ? "text" : "password"} value={value} onChange={(event) => setValue(event.target.value)}
          minLength={10} maxLength={72} autoComplete="new-password" aria-describedby={`${id}-hint`}
          className="w-full rounded-md border border-[#dcdcd6] bg-white py-2.5 pl-3 pr-10 font-mono text-sm text-[#20211f] outline-none focus:border-[#a4502f] focus-visible:ring-2 focus-visible:ring-[#a4502f]/20" />
        <button type="button" onClick={() => setVisible((shown) => !shown)} aria-label={visible ? "Hide password" : "Show password"}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-[#6b6d66] hover:text-[#20211f]">{visible ? <EyeOff size={15} /> : <Eye size={15} />}</button>
      </div>
      <Button type="button" variant="secondary" onClick={generate} className="shrink-0"><KeyRound size={14} /> Generate</Button>
    </div>
    <p id={`${id}-hint`} className="mt-1.5 text-[11px] text-[#6b6d66]">Leave blank if they use Google. Otherwise they confirm their email, sign in with this password, and must choose their own.</p>
  </div>;
}
