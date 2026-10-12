// Column lists mirror the grants in migration 012: private fields are not
// selectable on `talent` and live in `talent_private_details`.
export const TALENT_COLUMNS = [
  "id", "talent_id", "slug", "first_name", "last_name", "display_name", "location", "gender", "date_joined", "status",
  "publication_status", "show_on_website", "show_in_search", "featured", "show_age", "show_measurements", "show_portfolio",
  "show_videos", "show_resume", "show_comp_card", "is_minor", "guardian_required", "consent_status", "guardian_contact_id",
  "public_bio", "archived_at", "created_at", "updated_at", "crm_status", "crm_programs",
].join(",");

export const PRIVATE_COLUMNS = [
  "talent_id", "date_of_birth", "birth_place", "nationality", "mobile", "phone", "email", "website", "allow_sms",
  "email_icalendar", "username", "talent_login_enabled", "talent_app_enabled", "minimum_tariff", "minimum_hourly_rate",
  "minimum_day_rate", "notes", "updated_at",
].join(",");

export type PublicationStatus = "draft" | "review" | "published" | "archived";

export type TalentCore = {
  id: string;
  talent_id: string | null;
  slug: string;
  first_name: string;
  last_name: string;
  display_name: string;
  location: string | null;
  gender: string | null;
  date_joined: string | null;
  status: string;
  publication_status: PublicationStatus;
  show_on_website: boolean;
  show_in_search: boolean;
  featured: boolean;
  show_age: boolean;
  show_measurements: boolean;
  show_portfolio: boolean;
  show_videos: boolean;
  show_resume: boolean;
  show_comp_card: boolean;
  is_minor: boolean;
  guardian_required: boolean;
  consent_status: "not_required" | "pending" | "granted" | "withdrawn";
  guardian_contact_id: string | null;
  public_bio: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  // From GHL (migration 026), read-only here: normalized CRM status and the
  // short pipeline tags ("Model Expo", "Talent Recruitment") they qualify through.
  crm_status: string | null;
  crm_programs: string[];
};

export type TalentPrivate = {
  talent_id: string;
  date_of_birth: string | null;
  birth_place: string | null;
  nationality: string | null;
  mobile: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  allow_sms: boolean;
  email_icalendar: boolean;
  username: string | null;
  talent_login_enabled: boolean;
  talent_app_enabled: boolean;
  minimum_tariff: number | null;
  minimum_hourly_rate: number | null;
  minimum_day_rate: number | null;
  notes: string | null;
  updated_at: string;
};

export type BoardOption = { id: string; name: string; path: string; is_active: boolean; internal_only: boolean; publish_to_website: boolean };

export const GENDER_OPTIONS = ["Female", "Male", "Non-binary", "Other"].map((value) => ({ value, label: value }));

export const CONSENT_OPTIONS = [
  { value: "not_required", label: "Not required" },
  { value: "pending", label: "Pending" },
  { value: "granted", label: "Granted" },
  { value: "withdrawn", label: "Withdrawn" },
];
