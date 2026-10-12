import { z } from "zod";
import { optionalBoolean, optionalDate, optionalNumber, optionalText, requiredText, slug, uuid } from "@/lib/validation";

export const talentCoreSchema = z.object({
  first_name: requiredText(80).optional(),
  last_name: requiredText(80).optional(),
  display_name: requiredText(160).optional(),
  slug: slug.optional(),
  talent_id: optionalText(40),
  location: optionalText(120),
  gender: optionalText(40),
  date_joined: optionalDate,
  status: z.enum(["active", "inactive", "on_hold", "former"]).optional(),
  public_bio: optionalText(5000),
  is_minor: optionalBoolean,
  guardian_required: optionalBoolean,
  consent_status: z.enum(["not_required", "pending", "granted", "withdrawn"]).optional(),
  guardian_contact_id: uuid.nullable().optional().or(z.literal("").transform(() => null)),
  show_age: optionalBoolean,
  show_measurements: optionalBoolean,
  show_portfolio: optionalBoolean,
  show_videos: optionalBoolean,
  show_resume: optionalBoolean,
  show_comp_card: optionalBoolean,
});

export const privateDetailsSchema = z.object({
  date_of_birth: optionalDate,
  birth_place: optionalText(120),
  nationality: optionalText(120),
  mobile: optionalText(60),
  phone: optionalText(60),
  email: z.string().trim().max(254).refine((value) => value === "" || z.email().safeParse(value).success, "Invalid email")
    .transform((value) => (value === "" ? null : value.toLowerCase())).nullable().optional(),
  website: optionalText(240),
  allow_sms: optionalBoolean,
  email_icalendar: optionalBoolean,
  username: optionalText(80),
  talent_login_enabled: optionalBoolean,
  talent_app_enabled: optionalBoolean,
  minimum_tariff: optionalNumber,
  minimum_hourly_rate: optionalNumber,
  minimum_day_rate: optionalNumber,
  notes: optionalText(10000),
});

export const updateTalentSchema = z.object({
  core: talentCoreSchema.optional(),
  private: privateDetailsSchema.optional(),
}).refine((value) => value.core || value.private, "Nothing to update");

export const createTalentSchema = z.object({
  first_name: requiredText(80),
  last_name: optionalText(80),
  display_name: optionalText(160),
  gender: optionalText(40),
  location: optionalText(120),
  is_minor: optionalBoolean,
  date_of_birth: optionalDate,
  board_ids: z.array(uuid).max(20).optional(),
});

export const publicationActions = ["publish", "unpublish", "review", "draft", "archive", "restore"] as const;

export const publicationSchema = z.union([
  z.object({ action: z.enum(publicationActions) }),
  z.object({ featured: z.boolean() }),
  z.object({ show_in_search: z.boolean() }),
]);
