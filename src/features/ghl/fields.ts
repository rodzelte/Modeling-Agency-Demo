// Field mapping between GHL and the dashboard. Pure: unit tested.
//
// * Native GHL contact properties (name, email, phone, date of birth, address)
//   always map to the same places.
// * Custom fields map through ghl_field_definitions.target, which staff can edit.
//   DEFAULT_TARGETS only seeds known GHL field keys the first time a field is
//   discovered; anything else stays unmapped but is kept in ghl_contacts.custom_fields.
// * Every value is normalized to a comparable string, so "5'9"" in GHL and 175 cm
//   in the dashboard compare as equal (that equality is what stops sync loops).
import { parseDate, parseHeight, parseLength } from "../applications/ghl.ts";

export type Ownership = "ghl_only" | "dashboard_only" | "bidirectional";
export type PhotoRole = "headshot" | "three_quarter" | "full_body";

export const CUSTOM_TARGETS = {
  gender: { label: "Gender", ownership: "bidirectional" },
  location: { label: "Location", ownership: "bidirectional" },
  date_of_birth: { label: "Date of birth", ownership: "bidirectional" },
  instagram: { label: "Instagram", ownership: "bidirectional" },
  tiktok: { label: "TikTok", ownership: "bidirectional" },
  youtube: { label: "YouTube", ownership: "bidirectional" },
  height_cm: { label: "Height", ownership: "bidirectional" },
  bust_cm: { label: "Bust / chest", ownership: "bidirectional" },
  waist_cm: { label: "Waist", ownership: "bidirectional" },
  hips_cm: { label: "Hips", ownership: "bidirectional" },
  weight_kg: { label: "Weight", ownership: "bidirectional" },
  shoe_size: { label: "Shoe size", ownership: "bidirectional" },
  shirt_size: { label: "Shirt size", ownership: "bidirectional" },
  pants_size: { label: "Pants size", ownership: "bidirectional" },
  dress_size: { label: "Dress size", ownership: "bidirectional" },
  hair_color: { label: "Hair colour", ownership: "bidirectional" },
  eye_color: { label: "Eye colour", ownership: "bidirectional" },
  ethnicity: { label: "Ethnicity", ownership: "ghl_only" },
  photo_headshot: { label: "Photo: headshot", ownership: "ghl_only" },
  photo_three_quarter: { label: "Photo: 3/4 angle", ownership: "ghl_only" },
  photo_full_body: { label: "Photo: full body", ownership: "ghl_only" },
  photo_gallery: { label: "Photos: other", ownership: "ghl_only" },
} as const satisfies Record<string, { label: string; ownership: Ownership }>;
export type CustomTarget = keyof typeof CUSTOM_TARGETS;

export const NATIVE_TARGETS = {
  first_name: "First name", last_name: "Last name", email: "Email", phone: "Phone", date_of_birth: "Date of birth", address: "Address",
} as const;
export type NativeTarget = keyof typeof NATIVE_TARGETS;

export function isCustomTarget(value: unknown): value is CustomTarget {
  return typeof value === "string" && Object.hasOwn(CUSTOM_TARGETS, value);
}

// Known GHL field keys in the 42 Model Management location (seed only; editable).
export const DEFAULT_TARGETS: Record<string, CustomTarget> = {
  "contact.gender": "gender",
  "contact.current_location": "location",
  "contact.instagram": "instagram",
  "contact.tiktok": "tiktok",
  "contact.youtube": "youtube",
  "contact.height": "height_cm",
  "contact.bust": "bust_cm",
  "contact.chest": "bust_cm",
  "contact.waist": "waist_cm",
  "contact.hips": "hips_cm",
  "contact.weight": "weight_kg",
  "contact.shoe_size": "shoe_size",
  "contact.shirt_size": "shirt_size",
  "contact.pants_size": "pants_size",
  "contact.hair_color": "hair_color",
  "contact.eye_color": "eye_color",
  "contact.ethnicity": "ethnicity",
  "contact.headshot": "photo_headshot",
  "contact.34_angle": "photo_three_quarter",
  "contact.full_body": "photo_full_body",
  "contact.photos_of_the_models": "photo_gallery",
};

export const PHOTO_TARGETS: Partial<Record<CustomTarget, PhotoRole | null>> = {
  photo_headshot: "headshot", photo_three_quarter: "three_quarter", photo_full_body: "full_body", photo_gallery: null,
};

const clean = (value: unknown, max = 200): string | null => {
  if (value === null || value === undefined) return null;
  const text = (Array.isArray(value) ? value.join(", ") : String(value)).replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
};

const round1 = (value: number | null) => (value === null || !Number.isFinite(value) ? null : String(Math.round(value * 10) / 10));

// Weight in kg. GHL weights are typed freely ("120lbs", "125", "56 kg"); a bare
// number is read as pounds unless it is marked kg (US agency forms).
export function parseWeight(value: unknown): number | null {
  const raw = clean(value, 30)?.toLowerCase();
  if (!raw) return null;
  const match = raw.match(/(\d{2,3}(?:\.\d+)?)\s*(kg|kgs|kilos?|lb|lbs|pounds?)?/);
  if (!match) return null;
  const amount = Number(match[1]);
  const kg = match[2]?.startsWith("k") ? amount : amount * 0.45359237;
  return kg >= 10 && kg <= 250 ? Math.round(kg * 10) / 10 : null;
}

// "https://www.instagram.com/name/?utm=..." or "@name" → "@name"; anything else kept as typed.
export function instagramHandle(value: unknown): string | null {
  const raw = clean(value, 200);
  if (!raw) return null;
  const url = raw.match(/instagram\.com\/([A-Za-z0-9._]{1,30})/i);
  if (url) return `@${url[1]}`;
  const handle = raw.match(/^@?([A-Za-z0-9._]{1,30})$/);
  return handle ? `@${handle[1]}` : raw.slice(0, 100);
}

// Comparable dashboard-side value for a target, or null when blank/unreadable.
// Unreadable values such as "N/A" become null here but stay in the raw CRM data.
export function normalizeValue(target: CustomTarget | NativeTarget, value: unknown): string | null {
  switch (target) {
    case "height_cm": return round1(parseHeight(value));
    case "bust_cm": case "waist_cm": case "hips_cm": return round1(parseLength(value));
    case "weight_kg": return round1(typeof value === "number" ? value : parseWeight(value));
    case "date_of_birth": return parseDate(value);
    case "instagram": return instagramHandle(value);
    case "email": return clean(value, 200)?.toLowerCase() ?? null;
    case "phone": return clean(value, 40);
    default: return clean(value, 200);
  }
}

// Dashboard value → what GHL stores (inches and feet for a US CRM).
export function ghlFormat(target: CustomTarget | NativeTarget, value: string | null): string | null {
  if (value === null) return null;
  const number = Number(value);
  switch (target) {
    case "height_cm": {
      const inches = Math.round(number / 2.54);
      return `${Math.floor(inches / 12)}'${inches % 12}"`;
    }
    case "bust_cm": case "waist_cm": case "hips_cm": return String(Math.round((number / 2.54) * 2) / 2);
    case "weight_kg": return `${Math.round(number / 0.45359237)} lbs`;
    default: return value;
  }
}

export type GhlFile = { id: string; url: string; name: string | null; mime: string | null; size: number | null };

// GHL FILE_UPLOAD values look like { "<uuid>": { url, meta: { originalname, mimetype, size } } }.
export function filesIn(value: unknown): GhlFile[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
    if (!entry || typeof entry !== "object") return [];
    const file = entry as { url?: unknown; meta?: { originalname?: unknown; mimetype?: unknown; size?: unknown; uuid?: unknown } };
    if (typeof file.url !== "string" || !/^https:\/\//.test(file.url)) return [];
    return [{
      id: typeof file.meta?.uuid === "string" ? file.meta.uuid : key,
      url: file.url,
      name: typeof file.meta?.originalname === "string" ? file.meta.originalname.slice(0, 200) : null,
      mime: typeof file.meta?.mimetype === "string" ? file.meta.mimetype : null,
      size: typeof file.meta?.size === "number" ? file.meta.size : null,
    }];
  });
}

// Readable text for a raw custom-field value in the dashboard (files become a count).
export function displayValue(value: unknown): string | null {
  const files = filesIn(value);
  if (files.length) return `${files.length} file${files.length === 1 ? "" : "s"}`;
  if (value && typeof value === "object" && !Array.isArray(value)) return null;
  return clean(value, 2000);
}
