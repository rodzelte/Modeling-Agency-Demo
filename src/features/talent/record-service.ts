import type { SupabaseClient } from "@supabase/supabase-js";
import { MASKED_BANKING_FIELDS, type RecordModule } from "./modules";

// Fields a new record must include, beyond what the schema accepts as optional
// (schemas are shared between create and update).
export const requiredOnCreate: Partial<Record<RecordModule, string[]>> = {
  contacts: ["name"],
  "contact-methods": ["kind", "value"],
  rates: ["rate_type", "amount"],
  social: ["platform"],
  skills: ["category", "skill"],
  measurements: ["measured_on"],
  notes: ["body"],
  items: ["item_type"],
  documents: ["file_name", "storage_path"],
};

export class RecordInputError extends Error {}

async function findOrCreate(supabase: SupabaseClient, table: string, match: Record<string, string>, name: string) {
  let query = supabase.from(table).select("id,name").ilike("name", name);
  for (const [key, value] of Object.entries(match)) query = query.eq(key, value);
  const { data: existing } = await query.limit(1).maybeSingle();
  if (existing) return existing as { id: string; name: string };
  const { data: created, error } = await supabase.from(table).insert({ ...match, name }).select("id,name").single();
  if (error || !created) throw new RecordInputError(`Could not add "${name}" to the ${table.replace("_", " ")} list`);
  return created as { id: string; name: string };
}

// Turns validated form input into the row written to the module's table.
export async function prepareRow(supabase: SupabaseClient, module: RecordModule, talentId: string, input: Record<string, unknown>, creating: boolean) {
  const row: Record<string, unknown> = { ...input };

  if (module === "skills" && (row.category || row.skill)) {
    if (!row.category || !row.skill) throw new RecordInputError("Category and skill are both required");
    const category = await findOrCreate(supabase, "skill_categories", {}, String(row.category));
    const skill = await findOrCreate(supabase, "skills", { category_id: category.id }, String(row.skill));
    Object.assign(row, { category: category.name, skill: skill.name, category_id: category.id, skill_id: skill.id });
  }

  if (module === "agencies") {
    if (row.agency_id) {
      const { data } = await supabase.from("agencies").select("id,name").eq("id", String(row.agency_id)).maybeSingle();
      if (!data) throw new RecordInputError("Agency not found");
      row.agency_name = data.name;
    } else if (row.agency_name) {
      const agency = await findOrCreate(supabase, "agencies", {}, String(row.agency_name));
      Object.assign(row, { agency_id: agency.id, agency_name: agency.name });
    } else if (creating) {
      throw new RecordInputError("Choose or name an agency");
    }
  }

  if (module === "documents") {
    if (row.storage_path && !String(row.storage_path).startsWith(`talent/${talentId}/`)) throw new RecordInputError("Invalid document path");
    if (row.archived !== undefined) row.archived_at = row.archived ? new Date().toISOString() : null;
    delete row.archived;
  }

  if (module === "banking") {
    for (const field of MASKED_BANKING_FIELDS) if (row[field] === null) delete row[field];
  }

  if (module === "addresses" && creating && !row.label) row.label = "Main";

  if (creating) {
    const missing = (requiredOnCreate[module] ?? []).filter((field) => row[field] === undefined || row[field] === null || row[field] === "");
    if (missing.length) throw new RecordInputError(`Required: ${missing.join(", ").replaceAll("_", " ")}`);
  }

  return row;
}
