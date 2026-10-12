import { NextResponse } from "next/server";
import { z } from "zod";
import { databaseError } from "@/lib/api";
import { requireApi } from "@/lib/agency-auth";
import { firstIssue } from "@/lib/validation";

const schema = z.object({ body: z.string().trim().min(1, "Write a note first").max(4000) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireApi("applications.manage");
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  const { supabase, user } = auth.context;
  const { error } = await supabase.from("application_notes").insert({ application_id: id, author_id: user.id, body: parsed.data.body });
  if (error) return databaseError(error, "add the note");
  return NextResponse.json({ ok: true }, { status: 201 });
}
