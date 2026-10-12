import { NextResponse } from "next/server";
import { databaseError } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { definedOnly, firstIssue } from "@/lib/validation";
import { taskSchema } from "@/features/operations/schemas";

// Anyone on the team can add tasks for themselves; operations managers can assign to others (RLS enforces both).
export async function POST(request: Request) {
  const auth = await requireApi("dashboard.access");
  if ("response" in auth) return auth.response;
  const parsed = taskSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  const { supabase, user, permissions } = auth.context;
  const assignee = parsed.data.assignee_id ?? user.id;
  if (assignee !== user.id && !permissions.has("operations.manage")) return NextResponse.json({ error: "You can only create tasks for yourself" }, { status: 403 });
  const { data, error } = await supabase.from("tasks").insert(definedOnly({ ...parsed.data, assignee_id: assignee })).select("id").single();
  if (error) return databaseError(error, "create the task");
  return NextResponse.json(data, { status: 201 });
}
