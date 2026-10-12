import { z } from "zod";

// What the owner's CDS and WebForFashion windows hand to Dashboard → CDS Import
// (scripts/cds/). Only these fields are kept; banking, legal, medical, passwords
// and notes are never collected.
const short = (max = 200) => z.string().trim().max(max);
const id = z.string().regex(/^\d{1,15}$/);
const scalar = z.union([z.string().max(500), z.number(), z.boolean(), z.null()]);
const date = z.iso.date().nullable().catch(null);

// From CDS (go.cdsglobal.com, General tab): identity and the CDS Talent ID.
export const cdsTalentSchema = z.object({
  cds_id: id,
  first_name: short(120),
  last_name: short(120),
  email: z.email().max(254).nullable().catch(null),
  phone: short(60).nullable(),
  gender: short(40).nullable(),
  location: short(120).nullable(),
  profile: z.object({ date_of_birth: date, date_joined: date, birth_place: short(120).nullable(), nationality: short(120).nullable(), website: short(300).nullable() }),
});

export const cdsMediaSchema = z.object({
  id,
  kind: z.enum(["image", "digital", "video"]),
  position: z.number().int().min(0).max(100_000),
  metadata: z.record(z.string().max(60), scalar).refine((value) => Object.keys(value).length <= 40, "Too many media fields"),
});

// From WebForFashion (CDS's media module): boards, stats, skills, portfolios and
// the full media list. Joined to the CDS record by email, then by name.
export const wffTalentSchema = z.object({
  wff_id: id,
  first_name: short(120),
  last_name: short(120),
  emails: z.array(z.email().max(254).catch("")).max(10).transform((list) => list.filter(Boolean)),
  phones: z.array(short(60)).max(10),
  cds_boards: z.array(short(120)).max(50),
  profile: z.object({
    date_of_birth: date,
    stats: z.record(z.string().max(60), short(120)).refine((value) => Object.keys(value).length <= 120, "Too many stats"),
    skills: z.array(z.object({ skill: short(120), level: short(40).nullable() })).max(100),
  }),
  portfolios: z.array(z.object({ id, name: short(120), website: z.boolean(), media: z.array(id).max(5000) })).max(50),
  media: z.array(cdsMediaSchema).max(10_000),
});

export const cdsIngestSchema = z.object({
  talents: z.array(cdsTalentSchema).max(25).optional(),
  wff: z.array(wffTalentSchema).max(3).optional(),
}).refine((value) => (value.talents?.length ?? 0) + (value.wff?.length ?? 0) > 0, "Nothing to save");

export type CdsTalentPayload = z.infer<typeof cdsTalentSchema>;
export type WffTalentPayload = z.infer<typeof wffTalentSchema>;
export type StagedProfile = CdsTalentPayload["profile"] & Partial<Pick<WffTalentPayload["profile"], "stats" | "skills">>;
export type StagedPortfolio = WffTalentPayload["portfolios"][number];
