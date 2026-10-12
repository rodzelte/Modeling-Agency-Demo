import { z } from "zod";
import type { Permission } from "@/lib/permissions";
import { optionalBoolean, optionalDate, optionalDateTime, optionalNumber, optionalText, requiredText, uuid } from "@/lib/validation";

// Per-talent record modules served by /api/dashboard/talents/[id]/records/[module].
// RLS enforces the same permissions; these checks give clear errors earlier.
type ModuleConfig = {
  table: string;
  view: Permission;
  edit: Permission;
  schema: z.ZodObject;
  singleton?: boolean;
  canUpdate?: boolean;
  canDelete?: boolean;
  // Sensitive tables are audited by database triggers; the rest by the API.
  auditedByDatabase?: boolean;
};

const relationship = z.enum(["parent", "guardian", "manager", "agent", "emergency", "other"]).nullable().optional()
  .or(z.literal("").transform(() => null));

export const recordModules = {
  addresses: {
    table: "talent_addresses", view: "talent.private.view", edit: "talent.private.edit", canUpdate: true, canDelete: true,
    schema: z.object({
      label: requiredText(80).optional(), address_1: optionalText(160), address_2: optionalText(160), address_3: optionalText(160),
      city: optionalText(100), state: optionalText(100), postal_code: optionalText(30), country: optionalText(100),
      phone: optionalText(60), mobile: optionalText(60), contact_name: optionalText(120),
      is_main: optionalBoolean, is_billing: optionalBoolean, is_loan_out: optionalBoolean,
    }),
  },
  contacts: {
    table: "talent_contacts", view: "talent.private.view", edit: "talent.private.edit", canUpdate: true, canDelete: true,
    schema: z.object({
      name: requiredText(120).optional(), relationship, email: optionalText(254), phone: optionalText(60), mobile: optionalText(60), notes: optionalText(2000),
    }),
  },
  "contact-methods": {
    table: "talent_contact_methods", view: "talent.private.view", edit: "talent.private.edit", canUpdate: true, canDelete: true,
    schema: z.object({
      kind: z.enum(["mobile", "phone", "email"]).optional(), value: requiredText(254).optional(), label: optionalText(80),
      is_default: optionalBoolean, add_to_cc: optionalBoolean,
    }),
  },
  rates: {
    table: "talent_rates", view: "talent.private.view", edit: "talent.private.edit", canUpdate: true, canDelete: true,
    schema: z.object({ rate_type: requiredText(80).optional(), amount: optionalNumber, currency: z.string().trim().toUpperCase().refine((value) => value === "" || /^[A-Z]{3}$/.test(value), "Use a 3-letter currency code").transform((value) => value || undefined).optional(), notes: optionalText(500) }),
  },
  social: {
    table: "talent_social_accounts", view: "talent.view", edit: "talent.edit", canUpdate: true, canDelete: true,
    schema: z.object({ platform: requiredText(40).optional(), handle: optionalText(120), url: optionalText(400), follower_count: optionalNumber, updated_on: optionalDate }),
  },
  skills: {
    table: "talent_skills", view: "talent.view", edit: "skills.edit", canUpdate: true, canDelete: true,
    schema: z.object({ category: requiredText(80).optional(), skill: requiredText(120).optional(), level: optionalText(40), notes: optionalText(2000), is_public: optionalBoolean }),
  },
  agencies: {
    table: "talent_agencies", view: "talent.view", edit: "agencies.manage", canUpdate: true, canDelete: true,
    schema: z.object({
      agency_id: uuid.optional(), agency_name: requiredText(160).optional(), country: optionalText(120), city: optionalText(120), phone: optionalText(60),
      mother_agency: optionalBoolean, mother_agency_percent: optionalNumber, other_mother_agency: optionalText(160), placement: optionalText(160),
      contract_received: optionalBoolean, assigned_on: optionalDate, start_date: optionalDate, end_date: optionalDate, notes: optionalText(2000),
    }),
  },
  measurements: {
    table: "talent_measurements", view: "talent.view", edit: "measurements.edit", canDelete: true,
    schema: z.object({
      measured_on: requiredText(10), is_official: optionalBoolean,
      height_cm: optionalNumber, bust_chest_cm: optionalNumber, waist_cm: optionalNumber, hips_cm: optionalNumber, weight_kg: optionalNumber,
      head_cm: optionalNumber, collar_cm: optionalNumber, inseam_cm: optionalNumber, outseam_cm: optionalNumber, sleeve_cm: optionalNumber,
      shoe_size_us: optionalText(20), shoe_size_custom: optionalText(30), suit_size: optionalText(20), suit_length: optionalText(20), gloves: optionalText(20),
      eye_color: optionalText(60), hair_color: optionalText(60), hair_length: optionalText(60), hair_type: optionalText(60),
      body_type: optionalText(60), ethnicity: optionalText(120), notes: optionalText(2000),
    }),
  },
  notes: {
    table: "talent_notes", view: "notes.view", edit: "notes.edit", canDelete: true,
    schema: z.object({ note_type: z.enum(["internal", "booking", "scouting", "development", "other"]).optional().or(z.literal("").transform(() => undefined)), body: requiredText(10000).optional() }),
  },
  items: {
    table: "talent_items", view: "operations.view", edit: "operations.manage", canUpdate: true, canDelete: true,
    schema: z.object({ item_type: requiredText(120).optional(), description: optionalText(500), size: optionalText(60), condition: optionalText(60), status: optionalText(40) }),
  },
  usages: {
    table: "talent_usages", view: "operations.view", edit: "operations.manage", canUpdate: true, canDelete: true,
    schema: z.object({
      event_type: optionalText(120), usage_type: optionalText(120), client: optionalText(160), product: optionalText(160), start_date: optionalDate, end_date: optionalDate,
      booker: optionalText(160), exclusivity: optionalText(160), board: optionalText(120), notes: optionalText(2000),
    }),
  },
  appointments: {
    table: "talent_appointments", view: "operations.view", edit: "operations.manage", canUpdate: true, canDelete: true,
    schema: z.object({
      event_type: optionalText(120), job_type: optionalText(120), client: optionalText(160), product: optionalText(160), start_at: optionalDateTime, end_at: optionalDateTime,
      status: optionalText(40), notes: optionalText(2000), cancelled: optionalBoolean, booker: optionalText(160), board: optionalText(120),
    }),
  },
  documents: {
    table: "talent_documents", view: "documents.view", edit: "documents.manage", canUpdate: true,
    schema: z.object({
      file_name: requiredText(240).optional(), storage_path: requiredText(500).optional(), description: optionalText(1000), category: optionalText(80),
      visibility: z.enum(["private", "staff"]).optional(), mime_type: optionalText(120), file_size: optionalNumber, archived: optionalBoolean,
      shared_with_talent: optionalBoolean,
    }),
  },
  legal: {
    table: "talent_legal", view: "legal.view", edit: "legal.edit", singleton: true, auditedByDatabase: true,
    schema: z.object({
      legal_first_name: optionalText(80), legal_middle_name: optionalText(80), legal_last_name: optionalText(80), company_name: optionalText(160),
      non_resident: optionalBoolean, freelancer: optionalBoolean, tax_number: optionalText(80), accounting_number: optionalText(80), insurance_number: optionalText(80),
      talent_tax_percent: optionalNumber, own_tax_responsible: optionalBoolean, talent_commission_percent: optionalNumber, account_balance: optionalNumber,
      reserve_amount: optionalNumber, credit_status: optionalText(80),
      contract_name: optionalText(160), contract_signed_on: optionalDate, contract_returned: optionalBoolean, contract_expires_on: optionalDate,
      work_permit_number: optionalText(80), work_permit_country: optionalText(120), work_permit_issued_on: optionalDate, work_permit_expires_on: optionalDate,
      passport_number: optionalText(40), passport_country: optionalText(120), passport_requested_on: optionalDate, passport_issued_on: optionalDate, passport_expires_on: optionalDate,
      visa_type: optionalText(80), visa_expires_on: optionalDate, driver_license_number: optionalText(40), driver_license_state: optionalText(60), driver_license_expires_on: optionalDate,
      stop_payments: optionalBoolean, stop_payments_notes: optionalText(2000),
    }),
  },
  banking: {
    table: "talent_banking", view: "banking.view", edit: "banking.edit", singleton: true, auditedByDatabase: true,
    schema: z.object({
      description: optionalText(500), contact: optionalText(160), account_name: optionalText(160),
      account_number: optionalText(64), routing_number: optionalText(64), swift_aba: optionalText(64),
    }),
  },
  medical: {
    table: "talent_medical", view: "medical.view", edit: "medical.edit", singleton: true, auditedByDatabase: true,
    schema: z.object({
      doctor: optionalText(160), office_address: optionalText(240), office_phone: optionalText(60), last_visit: optionalDate, medical_notes: optionalText(4000),
      medical_approval: optionalText(120), valid_through: optionalDate, last_image_date: optionalDate, availability: optionalText(160),
    }),
  },
} satisfies Record<string, ModuleConfig>;

export type RecordModule = keyof typeof recordModules;

export function getModule(name: string): (ModuleConfig & { name: RecordModule }) | null {
  return name in recordModules ? { ...(recordModules[name as RecordModule] as ModuleConfig), name: name as RecordModule } : null;
}

// Banking identifiers are shown masked, so an empty submitted value means "unchanged".
export const MASKED_BANKING_FIELDS = ["account_number", "routing_number", "swift_aba"] as const;

export function maskValue(value: unknown) {
  if (typeof value !== "string" || !value) return value ?? null;
  return value.length <= 4 ? "••••" : `•••• ${value.slice(-4)}`;
}
