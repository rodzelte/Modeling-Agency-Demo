import { NextResponse } from "next/server";
import { z } from "zod";
import { databaseError } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { definedOnly, firstIssue } from "@/lib/validation";
import { taskSchema } from "@/features/operations/schemas";

const updateSchema = taskSchema.partial().extend({ status: z.enum(["open", "done"]).optional() });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireApi("dashboard.access");
  if ("response" in auth) return auth.response;
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  const { data, error } = await auth.context.supabase.from("tasks").update(definedOnly(parsed.data)).eq("id", id).select("id").maybeSingle();
  if (error) return databaseError(error, "update the task");
  if (!data) return NextResponse.json({ error: "Task not found, or you cannot change it" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireApi("operations.manage");
  if ("response" in auth) return auth.response;
  const { error } = await auth.context.supabase.from("tasks").delete().eq("id", id);
  if (error) return databaseError(error, "delete the task");
  return NextResponse.json({ ok: true });
}
