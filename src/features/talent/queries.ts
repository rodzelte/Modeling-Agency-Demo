import type { SupabaseClient } from "@supabase/supabase-js";
import { BOARD_COLUMNS, buildBoardTree, type BoardRow } from "@/features/boards/tree";
import { photoUrls, type StoredPhoto } from "@/features/media/urls";
import type { PermissionSet } from "@/lib/permissions";
import { ageFromDob } from "@/lib/format";
import { PRIVATE_COLUMNS, TALENT_COLUMNS, type TalentCore, type TalentPrivate } from "./types";

export const PAGE_SIZE = 40;

export type TalentListFilters = { q?: string; status?: string; board?: string; program?: string; crm?: string; page?: number };

export type TalentListRow = TalentCore & { boards: { id: string; name: string }[]; age: number | null; thumbnail: string | null };

// PostgREST `or` filters are comma/parenthesis delimited; strip those from input.
function searchTerm(value: string) {
  return value.replace(/[,()%*\\]/g, " ").trim().slice(0, 80);
}

// Program tags in use, for the roster filter.
export async function loadPrograms(supabase: SupabaseClient) {
  const { data } = await supabase.from("talent").select("crm_programs").neq("crm_programs", "{}").limit(2000);
  return [...new Set(((data ?? []) as { crm_programs: string[] }[]).flatMap((row) => row.crm_programs))].sort();
}

export async function loadBoards(supabase: SupabaseClient) {
  const { data, error } = await supabase.from("boards").select(BOARD_COLUMNS);
  if (error) throw error;
  return buildBoardTree((data ?? []) as BoardRow[]);
}

export async function listTalent(supabase: SupabaseClient, permissions: PermissionSet, filters: TalentListFilters) {
  const page = Math.max(1, filters.page ?? 1);
  const embed = filters.board ? "talent_board_assignments!inner(board_id,boards(id,name))" : "talent_board_assignments(board_id,boards(id,name))";
  let query = supabase.from("talent").select(`${TALENT_COLUMNS},${embed}`, { count: "exact" });

  const term = filters.q ? searchTerm(filters.q) : "";
  if (term) query = query.or(`display_name.ilike.%${term}%,first_name.ilike.%${term}%,last_name.ilike.%${term}%,talent_id.ilike.%${term}%,location.ilike.%${term}%`);
  if (filters.status === "archived") query = query.eq("publication_status", "archived");
  else if (filters.status && ["draft", "review", "published"].includes(filters.status)) query = query.eq("publication_status", filters.status);
  else if (filters.status === "website") query = query.eq("publication_status", "published").eq("show_on_website", true);
  else if (filters.status !== "all") query = query.neq("publication_status", "archived");
  if (filters.board) query = query.eq("talent_board_assignments.board_id", filters.board);
  // GHL program tag ("Model Expo") and CRM status filters.
  const program = filters.program?.replace(/[{}",\\]/g, "").trim().slice(0, 30);
  if (program) query = query.contains("crm_programs", [program]);
  if (filters.crm && /^[a-z]{3,12}$/.test(filters.crm)) query = query.eq("crm_status", filters.crm);

  const { data, count, error } = await query
    .order("updated_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (error) throw error;

  const rows = (data ?? []) as unknown as (TalentCore & { talent_board_assignments: { board_id: string; boards: { id: string; name: string } | null }[] })[];
  const ids = rows.map((row) => row.id);

  const [privateResult, photoResult] = await Promise.all([
    permissions.has("talent.private.view") && ids.length
      ? supabase.from("talent_private_details").select("talent_id,date_of_birth").in("talent_id", ids)
      : Promise.resolve({ data: [] as { talent_id: string; date_of_birth: string | null }[] }),
    permissions.has("media.view") && ids.length
      ? supabase.from("talent_photos").select("id,talent_id,storage_bucket,storage_path,public_storage_path,featured,display_order").in("talent_id", ids).is("archived_at", null).order("featured", { ascending: false }).order("display_order")
      : Promise.resolve({ data: [] as (StoredPhoto & { talent_id: string })[] }),
  ]);

  const dobs = new Map((privateResult.data ?? []).map((row) => [row.talent_id, row.date_of_birth]));
  const primary = new Map<string, StoredPhoto>();
  for (const photo of (photoResult.data ?? []) as (StoredPhoto & { talent_id: string })[]) if (!primary.has(photo.talent_id)) primary.set(photo.talent_id, photo);
  const urls = await photoUrls(supabase, [...primary.values()]);

  const talent: TalentListRow[] = rows.map(({ talent_board_assignments, ...row }) => ({
    ...row,
    boards: talent_board_assignments.map((assignment) => assignment.boards).filter((board): board is { id: string; name: string } => Boolean(board)),
    age: ageFromDob(dobs.get(row.id) ?? null),
    thumbnail: primary.has(row.id) ? urls.get(primary.get(row.id)!.id) ?? null : null,
  }));

  return { talent, total: count ?? 0, page, pageCount: Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE)) };
}

export async function getTalent(supabase: SupabaseClient, id: string) {
  const { data, error } = await supabase.from("talent").select(TALENT_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  return data as unknown as TalentCore | null;
}

export async function getPrivateDetails(supabase: SupabaseClient, id: string) {
  const { data, error } = await supabase.from("talent_private_details").select(PRIVATE_COLUMNS).eq("talent_id", id).maybeSingle();
  if (error) throw error;
  return data as unknown as TalentPrivate | null;
}

export async function getAssignedBoardIds(supabase: SupabaseClient, id: string) {
  const { data, error } = await supabase.from("talent_board_assignments").select("board_id").eq("talent_id", id);
  if (error) throw error;
  return (data ?? []).map((row) => row.board_id as string);
}

export async function getRecords<T = Record<string, unknown>>(supabase: SupabaseClient, table: string, id: string, order: { column: string; ascending?: boolean } = { column: "created_at" }) {
  const { data, error } = await supabase.from(table).select("*").eq("talent_id", id).order(order.column, { ascending: order.ascending ?? true });
  if (error) throw error;
  return (data ?? []) as T[];
}

export async function getSingleton<T = Record<string, unknown>>(supabase: SupabaseClient, table: string, id: string) {
  const { data, error } = await supabase.from(table).select("*").eq("talent_id", id).maybeSingle();
  if (error) throw error;
  return data as T | null;
}
