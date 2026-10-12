import { z } from "zod";

// Form values arrive as strings; empty means "clear this field".
export const optionalText = (max = 240) =>
  z.string().trim().max(max).transform((value) => (value === "" ? null : value)).nullable().optional();

export const requiredText = (max = 240) => z.string().trim().min(1).max(max);

export const optionalDate = z
  .string()
  .trim()
  .refine((value) => value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value), "Use YYYY-MM-DD")
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .optional();

export const optionalDateTime = z
  .string()
  .trim()
  .refine((value) => value === "" || !Number.isNaN(Date.parse(value)), "Invalid date and time")
  .transform((value) => (value === "" ? null : new Date(value).toISOString()))
  .nullable()
  .optional();

export const optionalNumber = z
  .union([z.number(), z.string().trim()])
  .transform((value, context) => {
    if (value === "" || value === null) return null;
    const number = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(number) || number < 0) {
      context.addIssue({ code: "custom", message: "Enter a positive number" });
      return z.NEVER;
    }
    return number;
  })
  .nullable()
  .optional();

export const optionalBoolean = z.boolean().optional();

export const uuid = z.string().uuid();

export const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and hyphens");

export function slugify(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

// Removes keys whose value is undefined so updates only touch submitted fields.
export function definedOnly<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

export function firstIssue(error: z.ZodError) {
  const issue = error.issues[0];
  return issue ? `${issue.path.join(".") || "Input"}: ${issue.message}` : "Invalid input";
}
