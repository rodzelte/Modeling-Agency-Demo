// Maps a GoHighLevel submission (workflow webhook, custom webhook, or the import
// script) onto an application row. Pure: no I/O, so it is unit-tested directly.
//
// GHL payloads vary by form and workflow: standard contact fields arrive at the top
// level (first_name, email, contact_id ...), custom fields arrive under their label
// ("Height", "Upload Headshot") or inside customData / others / customFields. Keys
// are therefore matched loosely: lowercased with punctuation removed.

export type PhotoKind = "full_body" | "headshot" | "three_quarter" | "other";

export type MappedApplication = {
  externalId: string | null;
  fields: {
    first_name: string | null; last_name: string | null; email: string | null; phone: string | null;
    date_of_birth: string | null; gender: string | null; address: string | null; city: string | null; state: string | null;
    postal_code: string | null; country: string | null; instagram: string | null;
    height_cm: number | null; bust_cm: number | null; waist_cm: number | null; hips_cm: number | null;
    dress_size: string | null; shoe_size: string | null; hair_color: string | null; eye_color: string | null;
    message: string | null; guardian_name: string | null; guardian_email: string | null; guardian_phone: string | null;
    sms_consent: boolean | null; sms_consent_text: string | null; submitted_at: string | null;
  };
  extra: Record<string, string>;
  photos: { url: string; kind: PhotoKind }[];
};

type Entry = { key: string; norm: string; value: unknown };

const NESTED = ["customdata", "customfields", "others", "contact", "formdata", "fields", "data", "submission"];
const IGNORED = new Set(["location", "workflow", "triggerdata", "attributionsource", "lastattributionsource", "contactsource",
  "contacttype", "user", "id", "locationid", "formid", "pageurl", "pagename", "funnelid", "funnelstepid", "fullname", "name",
  "timezone", "ip", "useragent", "eventid", "submissionid", "sessionid", "fingerprint", "signature", "terms", "companyname"]);

export const normalizeKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, "");

// Flattens the payload into (label, value) entries, resolving customFields arrays
// ([{ id, key, name, value }]) with an optional id → label map from the GHL API.
export function flattenPayload(payload: unknown, fieldNames: Record<string, string> = {}): Entry[] {
  const entries: Entry[] = [];
  const visit = (value: unknown, depth: number) => {
    if (!value || typeof value !== "object" || depth > 3) return;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object" && "value" in item && ("id" in item || "key" in item || "name" in item)) {
          const record = item as { id?: string; key?: string; name?: string; value: unknown };
          const label = record.name ?? (record.id && fieldNames[record.id]) ?? record.key ?? record.id ?? "";
          if (label) entries.push({ key: label, norm: normalizeKey(label.replace(/^contact\./, "")), value: record.value });
        }
      }
      return;
    }
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const label = fieldNames[key] ?? key;
      const norm = normalizeKey(label.replace(/^contact\./, ""));
      if (NESTED.includes(norm) && item && typeof item === "object") {
        visit(item, depth + 1);
        continue;
      }
      entries.push({ key: label, norm, value: item });
    }
  };
  visit(payload, 0);
  return entries;
}

const isBlank = (value: unknown) => value === null || value === undefined || (typeof value === "string" && !value.trim()) || (Array.isArray(value) && !value.length);

function text(value: unknown, max = 500): string | null {
  if (isBlank(value)) return null;
  if (Array.isArray(value)) return text(value.filter((item) => typeof item === "string" || typeof item === "number").join(", "), max);
  if (typeof value === "object") return null;
  const result = String(value).replace(/\s+/g, " ").trim().slice(0, max);
  return result || null;
}

function find(entries: Entry[], aliases: string[], { contains = false } = {}) {
  for (const alias of aliases) {
    const hit = entries.find((entry) => (contains ? entry.norm.includes(alias) : entry.norm === alias) && !isBlank(entry.value));
    if (hit) return hit;
  }
  return undefined;
}

// Height in centimetres from 5'9", 5 ft 9 in, 5-9, 69 (inches), 175, 175cm, 1.75m.
export function parseHeight(value: unknown): number | null {
  const raw = text(value, 40);
  if (!raw) return null;
  let lower = raw.toLowerCase().replace(/’|′|`|´/g, "'").replace(/”|″|''/g, '"');
  // "5'7 cm": feet and inches with a wrong unit typed after them.
  if (lower.includes("'")) lower = lower.replace(/\s*cm$/, "");
  const feet = lower.match(/^(\d)\s*(?:'|ft|feet|foot|-|\s)\s*(\d{1,2}(?:\.\d+)?)?(?:\s+(\d)\/(\d))?\s*(?:"|in|inches)?$/);
  if (feet) {
    const fraction = feet[3] && Number(feet[4]) ? Number(feet[3]) / Number(feet[4]) : 0;
    const cm = (Number(feet[1]) * 12 + Number(feet[2] ?? 0) + fraction) * 2.54;
    return cm >= 90 && cm <= 240 ? Math.round(cm) : null;
  }
  // "510" = 5'10": feet then two-digit inches, no separator (impossible as cm).
  const compact = lower.match(/^([4-6])(0\d|1[01])$/);
  if (compact) return Math.round((Number(compact[1]) * 12 + Number(compact[2])) * 2.54);
  const metres = lower.match(/^(\d\.\d{1,2})\s*m$/);
  if (metres) return Math.round(Number(metres[1]) * 100);
  const number = lower.match(/^(\d{2,3}(?:\.\d+)?)\s*(cm|in|inches|")?$/);
  if (!number) return null;
  const amount = Number(number[1]);
  const unit = number[2];
  if (unit === "cm") return amount >= 90 && amount <= 240 ? Math.round(amount) : null;
  if (unit || (amount >= 36 && amount <= 90)) return Math.round(amount * 2.54);
  return amount >= 90 && amount <= 240 ? Math.round(amount) : null;
}

// Body measurement in centimetres. Bare numbers up to 60 are inches, above are cm.
export function parseLength(value: unknown): number | null {
  const raw = text(value, 30);
  if (!raw) return null;
  const match = raw.toLowerCase().match(/(\d{2,3}(?:\.\d+)?)\s*(cm|in|inches|")?/);
  if (!match) return null;
  const amount = Number(match[1]);
  const cm = match[2] === "cm" ? amount : match[2] || amount <= 60 ? amount * 2.54 : amount;
  return cm >= 30 && cm <= 200 ? Math.round(cm * 10) / 10 : null;
}

// ISO date from 1999-05-14, 05/14/1999, May 14, 1999, or epoch milliseconds.
export function parseDate(value: unknown): string | null {
  if (isBlank(value)) return null;
  let date: Date | null = null;
  if (typeof value === "number" || /^\d{10,13}$/.test(String(value))) {
    const number = Number(value);
    date = new Date(number < 1e11 ? number * 1000 : number);
  } else {
    const raw = String(value).trim();
    const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    const us = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (iso) date = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    else if (us) date = new Date(Date.UTC(Number(us[3]), Number(us[1]) - 1, Number(us[2])));
    else {
      // "May 14, 1999": parsed as local midnight, so read it back in local time.
      const parsed = new Date(raw);
      if (!Number.isNaN(parsed.getTime())) date = new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()));
    }
  }
  if (!date || Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  if (year < 1900 || date.getTime() > Date.now()) return null;
  return date.toISOString().slice(0, 10);
}

function parseBoolean(value: unknown): boolean | null {
  if (isBlank(value)) return null;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.length > 0;
  const raw = String(value).trim().toLowerCase();
  if (["false", "no", "n", "0", "off", "unchecked", "declined"].includes(raw)) return false;
  return true;
}

const PHOTO_HINTS: [RegExp, PhotoKind][] = [
  [/head\s*shot|headshot|face/, "headshot"],
  [/full\s*body|fullbody|full length|fulllength/, "full_body"],
  [/3\s*\/\s*4|34|three\s*quarter|threequarter/, "three_quarter"],
];
const PHOTO_KEY = /photo|image|picture|pic|headshot|full\s*body|fullbody|3\s*\/\s*4|threequarter|upload|snapshot|polaroid|digital/i;

function photoKind(key: string): PhotoKind {
  const lower = key.toLowerCase();
  return PHOTO_HINTS.find(([pattern]) => pattern.test(lower))?.[1] ?? "other";
}

// Every URL inside a value: plain strings, comma lists, arrays, { url } objects,
// and GHL's { "<uuid>": { url, meta } } file maps.
function urlsIn(value: unknown, depth = 0): string[] {
  if (depth > 4 || isBlank(value)) return [];
  if (typeof value === "string") return value.split(/[\s,]+/).filter((part) => /^https?:\/\//i.test(part));
  if (Array.isArray(value)) return value.flatMap((item) => urlsIn(item, depth + 1));
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.url === "string") return urlsIn(record.url, depth + 1);
    return Object.values(record).flatMap((item) => urlsIn(item, depth + 1));
  }
  return [];
}

export function mapGhlPayload(payload: unknown, fieldNames: Record<string, string> = {}): MappedApplication {
  const entries = flattenPayload(payload, fieldNames);
  const used = new Set<Entry>();
  const pick = (aliases: string[], options?: { contains?: boolean }) => {
    const hit = find(entries, aliases, options);
    if (hit) used.add(hit);
    return hit?.value;
  };

  // Photos first, so file fields never end up in text or extra fields.
  const photos: MappedApplication["photos"] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const urls = urlsIn(entry.value);
    if (!urls.length || !(PHOTO_KEY.test(entry.key) || urls.some((url) => /filesafe\.space|msgsndr|leadconnector/i.test(url)))) continue;
    used.add(entry);
    for (const url of urls) {
      if (seen.has(url) || photos.length >= 12) continue;
      seen.add(url);
      photos.push({ url, kind: photoKind(entry.key) });
    }
  }

  let firstName = text(pick(["firstname", "first", "givenname"]), 80);
  let lastName = text(pick(["lastname", "last", "surname", "familyname"]), 80);
  if (!firstName && !lastName) {
    const full = text(find(entries, ["fullname", "name", "contactname"])?.value, 160);
    if (full) [firstName, lastName] = [full.split(" ")[0], full.split(" ").slice(1).join(" ") || null];
  }

  // Combined "34-24-34" measurements fill bust/waist/hips when not given separately.
  const combined = text(pick(["measurement", "bustwaisthips"], { contains: true }), 40)?.match(/(\d{2,3})\D+(\d{2,3})\D+(\d{2,3})/);
  const consent = find(entries, ["smsconsent", "sms", "textconsent", "consenttosms", "smsoptin"]) ?? find(entries, ["sms", "consent", "textmessage", "optin"], { contains: true });
  if (consent) used.add(consent);

  const fields: MappedApplication["fields"] = {
    first_name: firstName,
    last_name: lastName,
    email: text(pick(["email", "emailaddress"]), 200)?.toLowerCase() ?? null,
    phone: text(pick(["phone", "phonenumber", "mobile", "mobilephone", "cell", "cellphone"]), 40),
    date_of_birth: parseDate(pick(["dateofbirth", "dob", "birthday", "birthdate"])),
    gender: text(pick(["gender", "sex"]), 30),
    address: text(pick(["address1", "address", "streetaddress", "street"]), 200),
    city: text(pick(["city", "town"]), 100),
    state: text(pick(["state", "province", "region"]), 100),
    postal_code: text(pick(["postalcode", "zip", "zipcode", "postcode"]), 20),
    country: text(pick(["country"]), 100),
    instagram: text(pick(["instagram", "instagramhandle", "instagramusername", "ig", "instagramurl"]), 120),
    height_cm: parseHeight(pick(["height", "heightftin", "heightinches", "heightcm"])),
    bust_cm: parseLength(pick(["bust", "chest", "bustchest", "chestbust"])) ?? (combined ? parseLength(combined[1]) : null),
    waist_cm: parseLength(pick(["waist"])) ?? (combined ? parseLength(combined[2]) : null),
    hips_cm: parseLength(pick(["hips", "hip"])) ?? (combined ? parseLength(combined[3]) : null),
    dress_size: text(pick(["dresssize", "dress"]), 20),
    shoe_size: text(pick(["shoesize", "shoe", "shoes"]), 20),
    hair_color: text(pick(["haircolor", "haircolour", "hair"]), 40),
    eye_color: text(pick(["eyecolor", "eyecolour", "eyes", "eye"]), 40),
    message: text(pick(["message", "comments", "comment", "aboutyou", "tellusaboutyourself", "aboutme", "bio", "notes", "additionalinformation"]), 4000),
    guardian_name: text(pick(["parentguardianname", "guardianname", "parentname", "parentorguardianname", "guardian"]), 160),
    guardian_email: text(pick(["parentguardianemail", "guardianemail", "parentemail"]), 200)?.toLowerCase() ?? null,
    guardian_phone: text(pick(["parentguardianphone", "guardianphone", "parentphone"]), 40),
    sms_consent: consent ? parseBoolean(consent.value) : null,
    sms_consent_text: consent ? text(typeof consent.value === "string" && consent.value.length > 20 ? consent.value : consent.key, 1000) : null,
    submitted_at: (() => {
      const value = pick(["datesubmitted", "submittedat", "createdat", "dateadded", "timestamp"]);
      const iso = typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value) : null;
      return iso && iso.getTime() <= Date.now() + 60_000 ? iso.toISOString() : null;
    })(),
  };

  const externalId = text(find(entries, ["contactid"])?.value, 120) ?? text((payload as { contact?: { id?: unknown } })?.contact?.id, 120) ?? null;

  const extra: Record<string, string> = {};
  for (const entry of entries) {
    if (used.has(entry) || IGNORED.has(entry.norm) || entry.norm === "contactid") continue;
    const value = text(entry.value, 500);
    if (!value || Object.keys(extra).length >= 60) continue;
    extra[entry.key.slice(0, 80)] = value;
  }

  return { externalId, fields, extra, photos };
}
