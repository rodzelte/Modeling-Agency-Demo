import { z } from "zod";
import { optionalDate, optionalNumber, optionalText } from "@/lib/validation";

// Validation for companies, contacts, bookings, money and tasks (API routes).
export const COMPANY_KINDS = ["client", "brand", "agency", "photographer", "production", "casting", "other"] as const;
export const BOOKING_TYPES = ["shoot", "show", "fitting", "casting", "campaign", "event", "travel", "other"] as const;
export const BOOKING_STATUSES = ["option", "confirmed", "cancelled", "completed"] as const;
export const INVOICE_STATUSES = ["not_invoiced", "invoiced", "paid", "written_off"] as const;
export const RATE_TYPES = ["day", "half_day", "hourly", "flat", "tbc"] as const;

export const LABELS = {
  company: { client: "Client", brand: "Brand", agency: "Agency", photographer: "Photographer", production: "Production", casting: "Casting", other: "Other" },
  booking: { shoot: "Shoot", show: "Show", fitting: "Fitting", casting: "Casting", campaign: "Campaign", event: "Event", travel: "Travel", other: "Other" },
  status: { option: "Option", confirmed: "Confirmed", cancelled: "Cancelled", completed: "Completed" },
  invoice: { not_invoiced: "Not invoiced", invoiced: "Invoiced", paid: "Paid", written_off: "Written off" },
  rate: { day: "Day rate", half_day: "Half day", hourly: "Hourly", flat: "Flat fee", tbc: "To be confirmed" },
} as const;

const email = z.string().trim().max(200).refine((value) => value === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), "Enter a valid email").transform((value) => value || null).nullable().optional();
const website = z.string().trim().max(300).refine((value) => value === "" || /^https?:\/\/\S+$/.test(value), "Start the website with https://").transform((value) => value || null).nullable().optional();
const uuidOrNull = z.string().trim().refine((value) => value === "" || /^[0-9a-f-]{36}$/i.test(value), "Invalid selection").transform((value) => value || null).nullable().optional();

export const companySchema = z.object({
  name: z.string().trim().min(1, "Add a company name").max(160),
  kind: z.enum(COMPANY_KINDS).default("client"),
  website, email, billing_email: email,
  phone: optionalText(60), address_1: optionalText(200), city: optionalText(100), state: optionalText(100), postal_code: optionalText(30), country: optionalText(100),
  notes: optionalText(4000),
  is_active: z.boolean().optional(),
});

export const contactSchema = z.object({
  name: z.string().trim().min(1, "Add the contact's name").max(160),
  title: optionalText(120), email, phone: optionalText(60), notes: optionalText(2000), is_primary: z.boolean().optional(),
});

// Dates arrive from <input type="datetime-local"> (local time) or date inputs for all-day bookings.
const when = z.string().trim().refine((value) => !Number.isNaN(Date.parse(value)), "Choose a date and time");

export const bookingSchema = z.object({
  title: z.string().trim().min(1, "Add a booking title").max(200),
  booking_type: z.enum(BOOKING_TYPES).default("shoot"),
  status: z.enum(BOOKING_STATUSES).default("option"),
  company_id: uuidOrNull,
  contact_id: uuidOrNull,
  start_at: when,
  end_at: when,
  all_day: z.boolean().default(false),
  location: optionalText(300),
  usage_terms: optionalText(2000),
  notes: optionalText(4000),
  talent_ids: z.array(z.string().uuid()).max(50).optional(),
}).refine((value) => Date.parse(value.end_at) >= Date.parse(value.start_at), { message: "The booking must end after it starts", path: ["end_at"] });

export const financialsSchema = z.object({
  rate_type: z.enum(RATE_TYPES).nullable().optional().or(z.literal("").transform(() => null)),
  fee_total: optionalNumber,
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code").default("USD"),
  commission_pct: optionalNumber.refine((value) => value === null || value === undefined || value <= 100, "Commission cannot exceed 100%"),
  expenses: optionalNumber,
  invoice_status: z.enum(INVOICE_STATUSES).default("not_invoiced"),
  invoice_number: optionalText(60),
  invoiced_on: optionalDate,
  paid_on: optionalDate,
  notes: optionalText(2000),
  talent_fees: z.array(z.object({ talent_id: z.string().uuid(), fee: optionalNumber, paid_to_talent_on: optionalDate })).max(50).optional(),
});

export const taskSchema = z.object({
  title: z.string().trim().min(1, "Add a task").max(200),
  notes: optionalText(2000),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  due_on: optionalDate,
  assignee_id: uuidOrNull,
  related_type: z.enum(["talent", "booking", "company", "application"]).nullable().optional(),
  related_id: uuidOrNull,
});
