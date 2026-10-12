export function ageFromDob(dob: string | null | undefined, today = new Date()) {
  if (!dob) return null;
  const birth = new Date(`${dob}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return null;
  let age = today.getFullYear() - birth.getFullYear();
  const beforeBirthday = today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate());
  if (beforeBirthday) age -= 1;
  return age >= 0 ? age : null;
}

// Rounds to whole inches before splitting, so 182 cm renders 6' 0" rather than 6' 12".
export function feetInches(cm: number) {
  const totalInches = Math.round(cm / 2.54);
  return `${Math.floor(totalInches / 12)}' ${totalInches % 12}"`;
}

export function inches(cm: number) {
  return `${Math.round((cm / 2.54) * 2) / 2}"`;
}

export function heightLabel(cm: number | null | undefined) {
  return cm ? `${feetInches(cm)} / ${Math.round(cm)} cm` : null;
}

export function lengthLabel(cm: number | null | undefined) {
  return cm ? `${inches(cm)} / ${Math.round(cm)} cm` : null;
}

export function formatDate(value: string | null | undefined, options: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" }) {
  if (!value) return "—";
  const date = value.length === 10 ? new Date(`${value}T00:00:00`) : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-US", options);
}

export function formatDateTime(value: string | null | undefined) {
  return formatDate(value, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
