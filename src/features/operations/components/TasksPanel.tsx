"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import { formatDate } from "@/lib/format";
import { useMutation } from "@/lib/use-mutation";
import type { TaskRow } from "../queries";

const RELATED_PATH: Record<string, string> = { talent: "/dashboard/talent/", booking: "/dashboard/bookings/", company: "/dashboard/companies/", application: "/dashboard/applications/" };

export function TasksPanel({ tasks, members, viewerId, canAssign }: { tasks: TaskRow[]; members: { id: string; name: string }[]; viewerId: string; canAssign: boolean }) {
  const { run, pending } = useMutation();
  const [form, setForm] = useState({ title: "", due_on: "", priority: "normal", assignee_id: viewerId });
  const names = new Map(members.map((member) => [member.id, member.name]));
  const today = new Date().toISOString().slice(0, 10);

  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await run("/api/dashboard/tasks", { body: form, success: "Task added" })) setForm({ ...form, title: "", due_on: "" });
  }

  return <div className="space-y-4">
    <form onSubmit={add} className="grid grid-cols-1 items-end gap-3 rounded-xl border border-[#e7e7e3] bg-white p-4 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
      <TextField label="New task" name="title" required value={form.title} onChange={(title) => setForm({ ...form, title })} placeholder="e.g. Send call sheet to Acme" />
      <TextField label="Due" name="due_on" type="date" value={form.due_on} onChange={(due_on) => setForm({ ...form, due_on })} />
      <SelectField label="Priority" name="priority" value={form.priority} onChange={(priority) => setForm({ ...form, priority })} options={[{ value: "low", label: "Low" }, { value: "normal", label: "Normal" }, { value: "high", label: "High" }]} />
      <SelectField label="Assignee" name="assignee_id" value={form.assignee_id} onChange={(assignee_id) => setForm({ ...form, assignee_id })} disabled={!canAssign}
        options={(canAssign ? members : members.filter((member) => member.id === viewerId)).map((member) => ({ value: member.id, label: member.id === viewerId ? `${member.name} (me)` : member.name }))} />
      <Button type="submit" icon={<Plus size={14} />} disabled={pending || !form.title.trim()}>Add</Button>
    </form>

    {tasks.length ? <ul className="divide-y divide-[#f3f3f0] rounded-xl border border-[#e7e7e3] bg-white">{tasks.map((task) => {
      const overdue = task.status === "open" && task.due_on && task.due_on < today;
      return <li key={task.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
        <button type="button" aria-label={task.status === "open" ? `Mark “${task.title}” done` : `Reopen “${task.title}”`} disabled={pending}
          onClick={() => run(`/api/dashboard/tasks/${task.id}`, { method: "PATCH", body: { status: task.status === "open" ? "done" : "open" }, success: task.status === "open" ? "Done" : "Reopened" })}
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${task.status === "done" ? "border-[#4f7a54] bg-[#4f7a54] text-white" : "border-[#bdbdb6] hover:border-[#20211f]"}`}>{task.status === "done" && <Check size={12} />}</button>
        <div className="min-w-0 flex-1">
          <p className={`text-sm ${task.status === "done" ? "text-[#6b6d66] line-through" : "font-700"}`}>{task.title}</p>
          <p className="text-[11px] text-[#6b6d66]">
            {task.assignee_id ? names.get(task.assignee_id) ?? "Team member" : "Unassigned"}
            {task.related_type && task.related_id && <> · <Link href={`${RELATED_PATH[task.related_type]}${task.related_id}`} className="underline-offset-2 hover:underline">{task.related_type}</Link></>}
          </p>
        </div>
        {task.priority === "high" && <Badge tone="internal">High</Badge>}
        {task.due_on && <span className={`text-xs ${overdue ? "font-700 text-[#a9593d]" : "text-[#6b6d66]"}`}>{overdue ? "Overdue · " : "Due "}{formatDate(task.due_on)}</span>}
        {canAssign && <button type="button" aria-label={`Delete “${task.title}”`} onClick={() => window.confirm("Delete this task?") && run(`/api/dashboard/tasks/${task.id}`, { method: "DELETE", success: "Task deleted" })} className="rounded p-1.5 text-[#6b6d66] hover:bg-[#efefeb] hover:text-[#a9593d]"><Trash2 size={13} /></button>}
      </li>;
    })}</ul> : <p className="rounded-xl border border-dashed border-[#dcdcd6] bg-white px-6 py-10 text-center text-sm text-[#6b6d66]">No tasks here.</p>}
  </div>;
}
