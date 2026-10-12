// Pure rules for the CDS / WebForFashion import (migration 029). No Supabase or
// Next.js imports, so they are unit-tested directly (tests/unit/cds.test.mts).

// Agency placeholder records in CDS, never imported as talent.
const EXCLUDED = new Set(["modelluxemedia", "42modelmanagement"]);
const letters = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

export function isExcludedName(firstName: string, lastName: string) {
  return EXCLUDED.has(letters(`${firstName}${lastName}`));
}

// CDS locations are typed by hand ("Fort worth", "DALLAS", "..."): title-case
// real places, and drop placeholders so the dashboard shows "Location TBA".
const NO_LOCATION = new Set(["", "na", "none", "tba", "tbd", "unknown", "other", "cds"]);
export function normalizeLocation(value: string | null | undefined) {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (NO_LOCATION.has(letters(text))) return null;
  // "In Town" in CDS means in or near Dallas, the agency's home (owner, 2026-10-06).
  if (letters(text) === "intown") return "Dallas";
  return text.toLowerCase().replace(/(^|[\s\-/(])([a-z])/g, (_, before: string, first: string) => before + first.toUpperCase())
    .replace(/\b(Tx|Ny|Ca|Fl|Usa|Uk)\b/g, (code) => code.toUpperCase());
}

// ---------------------------------------------------------------------------
// Matching a CDS talent to an existing dashboard talent (never create twice)
// ---------------------------------------------------------------------------

export type MatchCandidate = {
  id: string; firstName: string; lastName: string;
  email: string | null; phones: (string | null)[]; dateOfBirth: string | null;
};
export type MatchInput = { firstName: string; lastName: string; email: string | null; phone: string | null; dateOfBirth: string | null };
export type MatchResult = { kind: "match"; id: string; reason: string } | { kind: "review"; reason: string } | { kind: "none" };

const lastTen = (value: string | null | undefined) => {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
};
const same = (a: string | null | undefined, b: string | null | undefined) => Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());

// Priority: email + first name, phone + first name, then full name (unique, with
// no conflicting date of birth). Several candidates, or a name match whose date
// of birth disagrees, go to manual review instead of guessing.
export function matchTalent(input: MatchInput, candidates: MatchCandidate[]): MatchResult {
  const firstNameMatches = candidates.filter((c) => letters(c.firstName) === letters(input.firstName) && letters(input.firstName) !== "");

  const byEmail = input.email ? firstNameMatches.filter((c) => same(c.email, input.email)) : [];
  if (byEmail.length === 1) return { kind: "match", id: byEmail[0].id, reason: "email" };
  if (byEmail.length > 1) return { kind: "review", reason: "Several talents share this email" };

  const phone = lastTen(input.phone);
  const byPhone = phone ? firstNameMatches.filter((c) => c.phones.some((p) => lastTen(p) === phone)) : [];
  if (byPhone.length === 1) return { kind: "match", id: byPhone[0].id, reason: "phone" };
  if (byPhone.length > 1) return { kind: "review", reason: "Several talents share this phone number" };

  const byName = firstNameMatches.filter((c) => letters(c.lastName) === letters(input.lastName));
  if (byName.length > 1) return { kind: "review", reason: "Several talents have this name" };
  if (byName.length === 1) {
    const candidate = byName[0];
    if (input.dateOfBirth && candidate.dateOfBirth && input.dateOfBirth !== candidate.dateOfBirth) {
      return { kind: "review", reason: "Same name, different date of birth" };
    }
    return { kind: "match", id: candidate.id, reason: "name" };
  }
  return { kind: "none" };
}

// ---------------------------------------------------------------------------
// CDS portfolio name -> website board
// ---------------------------------------------------------------------------

export type BoardRef = { id: string; name: string; parentId: string | null; segment: string };
export type BoardPlan =
  | { portfolio: string; kind: "existing"; boardId: string }
  | { portfolio: string; kind: "create"; parentName: string | null; name: string };

const PARENTS: [RegExp, string][] = [
  [/\b(girls?|boys?|teens?)\b/i, "Teens"],
  [/\bwomen\b/i, "Women"],
  [/\bmen\b/i, "Men"],
];
const lastSegment = (name: string) => name.split("/").pop()!.trim();
const words = (value: string) => value.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
const title = (value: string) => value.replace(/\b\w/g, (c) => c.toUpperCase());

// "Fashion-Women" -> Women / Fashion, "Development - Men" -> Men / Development,
// "Teens - Girls" -> Teens / Girls, "Women" -> Women, "Curve" -> an existing board
// named Curve if there is exactly one, else a new top-level board. Existing boards
// are reused by name; anything missing is created (as a draft, by the caller).
export function planPortfolioBoard(portfolio: string, boards: BoardRef[]): BoardPlan {
  const clean = words(portfolio);
  const top = (name: string) => boards.find((b) => !b.parentId && letters(lastSegment(b.name)) === letters(name));
  const childOf = (parentId: string, name: string) => boards.find((b) => b.parentId === parentId && (letters(lastSegment(b.name)) === letters(name) || b.segment === letters(name)));

  const rule = PARENTS.find(([pattern]) => pattern.test(clean));
  if (rule) {
    const parentName = rule[1];
    let rest = clean.replace(rule[1] === "Teens" ? /\bteens?\b/i : rule[0], " ");
    if (parentName === "Teens") rest = rest.replace(/\bgirls?\b/i, " Girls ").replace(/\bboys?\b/i, " Boys ");
    rest = words(rest.replace(/[&]/g, " & "));
    const parent = top(parentName);
    if (!rest) return parent ? { portfolio, kind: "existing", boardId: parent.id } : { portfolio, kind: "create", parentName: null, name: parentName };
    const child = parent && childOf(parent.id, rest);
    if (child) return { portfolio, kind: "existing", boardId: child.id };
    return { portfolio, kind: "create", parentName, name: title(rest) };
  }

  const unique = boards.filter((b) => letters(lastSegment(b.name)) === letters(clean));
  if (unique.length === 1) return { portfolio, kind: "existing", boardId: unique[0].id };
  return { portfolio, kind: "create", parentName: null, name: clean };
}

// ---------------------------------------------------------------------------
// Measurements: "175 cm" / "5'9\"" / "39.5" -> dashboard columns
// ---------------------------------------------------------------------------

const number = (value: string | undefined) => {
  const match = (value ?? "").replace(",", ".").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
};
const text = (value: string | undefined) => {
  const v = (value ?? "").trim();
  return v && v !== "..." && v !== "-" ? v : null;
};

export function measurementRow(stats: Record<string, string>) {
  const row = {
    height_cm: number(stats.height_cm),
    bust_chest_cm: number(stats.bust_cm),
    waist_cm: number(stats.waist_cm),
    hips_cm: number(stats.hips_cm),
    shoe_size_us: text(stats.shoe_us),
    hair_color: text(stats.hair_color),
    hair_length: text(stats.hair_length),
    hair_type: text(stats.hair_type),
    eye_color: text(stats.eyes_color),
    body_type: text(stats.body_type),
    dress_size: text(stats.dress_size_us),
    collar_cm: number(stats.collar_cm),
    head_cm: number(stats.head_cm),
  };
  return Object.values(row).some((value) => value !== null) ? row : null;
}

// ---------------------------------------------------------------------------
// Photo copy (WebForFashion → Supabase): which media to copy, and from where
// ---------------------------------------------------------------------------

// WebForFashion serves originals from one private S3 bucket through signed
// links. Only that bucket is fetched, so a posted URL cannot point the server
// at any other host.
const CDS_MEDIA_HOSTS = new Set([
  "cds-ob-619779309805-private-bucket.s3.eu-west-1.amazonaws.com",
  "cds-ob-619779309805-private-bucket.s3-eu-west-1.amazonaws.com",
]);
export function isCdsMediaUrl(url: URL) {
  return url.protocol === "https:" && CDS_MEDIA_HOSTS.has(url.hostname.toLowerCase()) && !url.port;
}

export type MediaItem = { id: string; kind: "image" | "digital" | "video"; position: number; metadata: Record<string, unknown> };
export type PortfolioRef = { name: string; website?: boolean; media: string[] };

// Not the whole library (owner, 2026-10-06: keep storage small): the photos in
// each CDS portfolio (these drive board placement), every digital, and the
// starred cover. A talent with no portfolios gets the photos marked WEB, or
// failing that the first 12 images, so every talent has pictures.
export const FALLBACK_PHOTOS = 12;
export function selectPhotos(media: MediaItem[], portfolios: PortfolioRef[]) {
  const images = media.filter((m) => m.kind !== "video");
  const inPortfolio = new Set(portfolios.flatMap((p) => p.media));
  let chosen = images.filter((m) => inPortfolio.has(m.id) || m.kind === "digital" || m.metadata.primary === true);
  if (!images.some((m) => inPortfolio.has(m.id))) {
    const web = images.filter((m) => m.kind === "image" && m.metadata.web === true);
    const extra = web.length ? web : images.filter((m) => m.kind === "image").sort((a, b) => a.position - b.position).slice(0, FALLBACK_PHOTOS);
    chosen = [...chosen, ...extra.filter((m) => !chosen.includes(m))];
  }
  return chosen.sort((a, b) => a.position - b.position).map((m) => m.id);
}

// The cover (profile picture): the photo starred in WebForFashion, else the
// first photo of the first portfolio, else the first copied image.
export function pickCover(media: MediaItem[], portfolios: PortfolioRef[], copied: Set<string>) {
  const starred = media.find((m) => m.metadata.primary === true && copied.has(m.id));
  if (starred) return starred.id;
  for (const portfolio of portfolios) {
    const first = portfolio.media.find((id) => copied.has(id));
    if (first) return first;
  }
  return media.filter((m) => m.kind === "image" && copied.has(m.id)).sort((a, b) => a.position - b.position)[0]?.id ?? null;
}
