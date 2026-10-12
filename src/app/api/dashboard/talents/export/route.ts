import { NextResponse } from "next/server";
import { requireApi } from "@/lib/agency-auth";
import { databaseError, writeAudit } from "@/lib/api";
import { csvCell } from "@/features/operations/export";

// Roster CSV for staff. Private columns (DOB, email, mobile) are included only
// when asked for (?private=1) AND the user holds talent.private.view. Audited.
export async function GET(request: Request) {
  const auth = await requireApi("talent.view");
  if ("response" in auth) return auth.response;
  const { supabase, permissions } = auth.context;
  const includePrivate = new URL(request.url).searchParams.get("private") === "1" && permissions.has("talent.private.view");

  const { data, error } = await supabase.from("talent")
    .select("id,talent_id,display_name,first_name,last_name,gender,location,publication_status,show_on_website,is_minor,date_joined,updated_at,talent_board_assignments(boards(name))")
    .neq("publication_status", "archived").order("display_name").limit(5000);
  if (error) return databaseError(error, "export the roster");
  type Row = { id: string; talent_id: string | null; display_name: string; first_name: string; last_name: string; gender: string | null; location: string | null; publication_status: string; show_on_website: boolean; is_minor: boolean; date_joined: string | null; updated_at: string; talent_board_assignments: { boards: { name: string } | { name: string }[] | null }[] };
  const rows = (data ?? []) as unknown as Row[];

  const privateById = new Map<string, { date_of_birth: string | null; email: string | null; mobile: string | null }>();
  if (includePrivate && rows.length) {
    const { data: details, error: privateError } = await supabase.from("talent_private_details").select("talent_id,date_of_birth,email,mobile").in("talent_id", rows.map((row) => row.id));
    if (privateError) return databaseError(privateError, "export the roster");
    for (const detail of details ?? []) privateById.set(detail.talent_id, detail);
  }

  const header = ["Talent ID", "Display name", "First name", "Last name", "Gender", "Location", "Boards", "Status", "On website", "Minor", "Joined", "Updated", ...(includePrivate ? ["Date of birth", "Email", "Mobile"] : [])];
  const lines = rows.map((row) => {
    const boards = row.talent_board_assignments.map((item) => (Array.isArray(item.boards) ? item.boards[0] : item.boards)?.name).filter(Boolean).join("; ");
    const extra = includePrivate ? [privateById.get(row.id)?.date_of_birth, privateById.get(row.id)?.email, privateById.get(row.id)?.mobile] : [];
    return [row.talent_id, row.display_name, row.first_name, row.last_name, row.gender, row.location, boards, row.publication_status, row.show_on_website ? "yes" : "no", row.is_minor ? "yes" : "no", row.date_joined, row.updated_at.slice(0, 10), ...extra].map(csvCell).join(",");
  });
  await writeAudit(supabase, { action: includePrivate ? "talent.exported_private" : "talent.exported", entityType: "talent", metadata: { rows: rows.length } });
  return new NextResponse(`﻿${[header.join(","), ...lines].join("\r\n")}\r\n`, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="42-roster-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "private, no-store" },
  });
}
