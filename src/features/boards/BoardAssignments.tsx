"use client";

import { Badge } from "@/components/ui/Badge";
import { useMutation } from "@/lib/use-mutation";

export type BoardChoice = { id: string; label: string; shortName: string; depth: number; isPublic: boolean; isActive: boolean; internalOnly: boolean };

export function boardStatus(board: Pick<BoardChoice, "isActive" | "internalOnly" | "isPublic">) {
  if (!board.isActive) return <Badge tone="inactive">Inactive</Badge>;
  if (board.internalOnly) return <Badge tone="internal">Internal</Badge>;
  if (!board.isPublic) return <Badge tone="draft">Unpublished</Badge>;
  return <Badge tone="public">Public</Badge>;
}

// A talent can sit on any number of boards. Toggling saves immediately; removing a
// board only removes the assignment, never the talent.
export function BoardAssignments({ talentId, boards, assigned, canAssign }: { talentId: string; boards: BoardChoice[]; assigned: string[]; canAssign: boolean }) {
  const { run, pending } = useMutation();

  async function toggle(board: BoardChoice, checked: boolean) {
    await run(`/api/dashboard/talents/${talentId}/boards`, {
      method: checked ? "POST" : "DELETE",
      body: { board_id: board.id },
      success: checked ? `Added to ${board.label}` : `Removed from ${board.label}`,
    });
  }

  const count = assigned.length;
  return <section className="space-y-3">
    <div>
      <h3 className="text-sm font-800">Boards <span className="ml-1 text-xs font-400 text-[#6b6d66]">{count} assigned</span></h3>
      <p className="mt-1 text-xs leading-5 text-[#6b6d66]">Published talent appears on every public board they are on. Internal and unpublished boards never show on the website.</p>
    </div>
    {boards.length ? <ul className="space-y-1">{boards.map((board) => {
      const checked = assigned.includes(board.id);
      return <li key={board.id} style={{ paddingLeft: board.depth * 18 }}>
        <label className={`flex items-center gap-3 rounded-md border px-3 py-2 text-xs ${checked ? "border-[#20211f] bg-[#fafaf8]" : "border-transparent hover:border-[#e7e7e3]"} ${canAssign ? "cursor-pointer" : "opacity-70"}`}>
          <input type="checkbox" className="h-4 w-4 shrink-0 accent-[#20211f]" checked={checked} disabled={!canAssign || pending} onChange={(event) => toggle(board, event.target.checked)} aria-label={board.label} />
          <span className={`flex-1 ${board.depth === 0 ? "font-700" : ""}`}>{board.shortName}</span>
          {boardStatus(board)}
        </label>
      </li>;
    })}</ul> : <p className="text-xs text-[#6b6d66]">No boards exist yet. Create them under Boards.</p>}
  </section>;
}
