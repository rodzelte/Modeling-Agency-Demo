import type { SupabaseClient } from "@supabase/supabase-js";

// Replaces the talent on a booking with the given list (adds and removes rows).
export async function setBookingTalent(supabase: SupabaseClient, bookingId: string, talentIds: string[]) {
  const { data: current, error } = await supabase.from("booking_talent").select("talent_id").eq("booking_id", bookingId);
  if (error) return error;
  const existing = new Set((current ?? []).map((row: { talent_id: string }) => row.talent_id));
  const wanted = new Set(talentIds);
  const remove = [...existing].filter((id) => !wanted.has(id));
  const add = [...wanted].filter((id) => !existing.has(id)).map((talent_id) => ({ booking_id: bookingId, talent_id }));
  if (remove.length) {
    const { error: removeError } = await supabase.from("booking_talent").delete().eq("booking_id", bookingId).in("talent_id", remove);
    if (removeError) return removeError;
  }
  if (add.length) {
    const { error: addError } = await supabase.from("booking_talent").insert(add);
    if (addError) return addError;
  }
  return null;
}

export type Conflict = { talent_id: string; kind: "booking" | "appointment"; record_id: string; label: string; status: string; start_at: string; end_at: string };

export async function findConflicts(supabase: SupabaseClient, talentIds: string[], start: string, end: string, excludeBooking?: string) {
  if (!talentIds.length) return [];
  const { data, error } = await supabase.rpc("talent_booking_conflicts", {
    p_talent_ids: talentIds, p_start: start, p_end: end, p_exclude_booking: excludeBooking ?? null,
  });
  if (error) throw error;
  return (data ?? []) as Conflict[];
}
