// The one-line talent summary used in the roster and the talent header:
// "Dallas · Female · 37 yrs". A missing location reads "Location TBA" so every
// row has the same shape; the talent ID is shown separately, not in this line.
export function talentSummary(location: string | null | undefined, gender: string | null | undefined, age: number | null) {
  return [location?.trim() || "Location TBA", gender?.trim() || null, age !== null ? `${age} yrs` : null].filter(Boolean).join(" · ");
}
