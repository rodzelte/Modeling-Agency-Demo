"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Eye, EyeOff, FolderPlus, Pencil, Plus, Power, Users } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { CheckboxField, SelectField, TextareaField, TextField } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/States";
import { readForm } from "@/lib/read-form";
import { useMutation } from "@/lib/use-mutation";
import type { BoardNode } from "./tree";

type Editing = { mode: "new"; parentId: string | null } | { mode: "edit"; board: BoardNode };

function descendants(board: BoardNode): string[] {
  return board.children.flatMap((child) => [child.id, ...descendants(child)]);
}

export function BoardManager({ roots, flat, counts, canManage }: { roots: BoardNode[]; flat: BoardNode[]; counts: Record<string, number>; canManage: boolean }) {
  const { run, pending } = useMutation();
  const [editing, setEditing] = useState<Editing | null>(null);

  async function reorder(siblings: BoardNode[], index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= siblings.length) return;
    const ids = siblings.map((board) => board.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await run("/api/dashboard/boards/reorder", { body: { board_ids: ids }, success: "Order saved" });
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const body = readForm(event.currentTarget);
    const saved = editing.mode === "new"
      ? await run("/api/dashboard/boards", { body, success: "Board created" })
      : await run(`/api/dashboard/boards/${editing.board.id}`, { method: "PATCH", body, success: "Board saved" });
    if (saved) setEditing(null);
  }

  const current = editing?.mode === "edit" ? editing.board : null;
  const blocked = new Set(current ? [current.id, ...descendants(current)] : []);
  const parentOptions = flat.filter((board) => !blocked.has(board.id)).map((board) => ({ value: board.id, label: board.label }));
  const defaultParent = editing?.mode === "new" ? editing.parentId : current?.parent_board_id ?? null;

  function Node({ board, siblings, index }: { board: BoardNode; siblings: BoardNode[]; index: number }) {
    const count = counts[board.id] ?? 0;
    return <li>
      <div className={`flex flex-wrap items-center gap-3 rounded-lg border bg-white px-4 py-3 ${board.is_active ? "border-[#e7e7e3]" : "border-dashed border-[#dcdcd6] opacity-70"}`} style={{ marginLeft: board.depth * 24 }}>
        <div className="min-w-0 flex-1">
          <p className="font-700">{board.shortName}</p>
          <p className="truncate text-[11px] text-[#6b6d66]">
            {board.isPublic ? <a href={`/models/${board.path}`} target="_blank" rel="noreferrer" className="hover:text-[#a4502f] hover:underline">/models/{board.path}</a> : <span>No public page</span>}
            {board.description ? ` · ${board.description}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {!board.is_active ? <Badge tone="inactive">Inactive</Badge> : board.internal_only ? <Badge tone="internal">Internal</Badge> : board.isPublic ? <Badge tone="public">On website</Badge> : <Badge tone="draft">Not published</Badge>}
          {board.isPublic && !board.show_in_navigation && <Badge>Hidden from menu</Badge>}
          {board.is_minor_board && <Badge tone="review">Minors</Badge>}
        </div>
        <Link href={`/dashboard/talent?board=${board.id}`} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-[#5f615b] hover:bg-[#efefeb]"><Users size={13} aria-hidden />{count} talent</Link>
        {canManage && <div className="flex gap-1">
          <IconButton label="Move up" disabled={pending || index === 0} onClick={() => reorder(siblings, index, -1)}><ArrowUp size={13} /></IconButton>
          <IconButton label="Move down" disabled={pending || index === siblings.length - 1} onClick={() => reorder(siblings, index, 1)}><ArrowDown size={13} /></IconButton>
          <IconButton label="Add child board" onClick={() => setEditing({ mode: "new", parentId: board.id })}><FolderPlus size={13} /></IconButton>
          <IconButton label={board.publish_to_website ? "Unpublish from website" : "Publish to website"} disabled={pending}
            onClick={() => run(`/api/dashboard/boards/${board.id}`, { method: "PATCH", body: { publish_to_website: !board.publish_to_website }, success: board.publish_to_website ? "Board hidden from the website" : "Board published to the website" })}>
            {board.publish_to_website ? <EyeOff size={13} /> : <Eye size={13} />}
          </IconButton>
          <IconButton label={board.is_active ? "Deactivate" : "Activate"} disabled={pending}
            onClick={() => (board.is_active ? window.confirm(`Deactivate "${board.name}"? It disappears from the website; its talent and assignments are kept.`) : true) && run(`/api/dashboard/boards/${board.id}`, { method: "PATCH", body: { is_active: !board.is_active }, success: board.is_active ? "Board deactivated" : "Board activated" })}>
            <Power size={13} />
          </IconButton>
          <IconButton label="Edit board" onClick={() => setEditing({ mode: "edit", board })}><Pencil size={13} /></IconButton>
        </div>}
      </div>
      {board.children.length > 0 && <ul className="mt-2 space-y-2">{board.children.map((child, childIndex) => <Node key={child.id} board={child} siblings={board.children} index={childIndex} />)}</ul>}
    </li>;
  }

  return <div className="space-y-4">
    {canManage && <div className="flex justify-end"><Button icon={<Plus size={14} />} onClick={() => setEditing({ mode: "new", parentId: null })}>New board</Button></div>}
    {roots.length ? <ul className="space-y-2">{roots.map((board, index) => <Node key={board.id} board={board} siblings={roots} index={index} />)}</ul>
      : <EmptyState title="No boards yet">{canManage ? "Create a top-level board such as Women, Men, or Teens, then add boards inside it." : undefined}</EmptyState>}

    <Dialog open={Boolean(editing)} onClose={() => setEditing(null)} title={current ? `Edit ${current.name}` : "New board"} description="Boards decide where published talent appears on the website." wide>
      {editing && <form onSubmit={submit} className="space-y-5" key={current?.id ?? `new-${defaultParent}`}>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Name" name="name" required defaultValue={current?.name} placeholder="Teens / Boys" />
          <SelectField label="Parent board" name="parent_board_id" defaultValue={defaultParent} options={parentOptions} placeholder="None (top level)" />
          <TextField label="URL segment" name="path_segment" defaultValue={current?.path_segment} hint="Lowercase and hyphens, e.g. boys → /models/teens/boys. Defaults to the name." />
          <TextField label="Slug (internal ID)" name="slug" defaultValue={current?.slug} hint="Unique across all boards. Defaults to the name." />
          <TextField label="Website section" name="website_section" defaultValue={current?.website_section} hint="Optional grouping for navigation, e.g. Fashion." />
          <TextareaField label="Description" name="description" defaultValue={current?.description} rows={2} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <CheckboxField label="Active" name="is_active" defaultChecked={current ? current.is_active : true} />
          <CheckboxField label="Publish to website" name="publish_to_website" defaultChecked={current ? current.publish_to_website : false} hint="Also requires a public parent board." />
          <CheckboxField label="Internal only" name="internal_only" defaultChecked={current?.internal_only} hint="Never shown publicly (e.g. Submissions, New leads)." />
          <CheckboxField label="Show in website menu" name="show_in_navigation" defaultChecked={current ? current.show_in_navigation : true} />
          <CheckboxField label="Minors board" name="is_minor_board" defaultChecked={current?.is_minor_board} />
        </div>
        <div className="flex justify-end gap-2 border-t border-[#efefeb] pt-4"><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save board"}</Button></div>
      </form>}
    </Dialog>
  </div>;
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled}
    className="rounded border border-[#e7e7e3] p-1.5 text-[#5f615b] hover:border-[#20211f] hover:text-[#20211f] disabled:cursor-not-allowed disabled:opacity-40">{children}</button>;
}
