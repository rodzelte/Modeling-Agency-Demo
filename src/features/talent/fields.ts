// Form and table definitions for talent record modules, shared by the generic
// RecordList / SingletonForm components. Field names match the API schemas in
// modules.ts.
export type FieldType = "text" | "email" | "url" | "tel" | "date" | "datetime-local" | "number" | "checkbox" | "select" | "textarea";
export type FieldDef = { name: string; label: string; type?: FieldType; options?: { value: string; label: string }[]; required?: boolean; hint?: string; wide?: boolean; list?: string };
export type ColumnFormat = "date" | "datetime" | "bool" | "height" | "length" | "number" | "money" | "text";
export type ColumnDef = { key: string; label: string; format?: ColumnFormat };
export type ModuleUi = { title: string; singular: string; description?: string; fields: FieldDef[]; columns: ColumnDef[]; canUpdate?: boolean; canDelete?: boolean };

const relationshipOptions = ["parent", "guardian", "manager", "agent", "emergency", "other"].map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }));

export const moduleUi = {
  addresses: {
    title: "Addresses", singular: "address", canUpdate: true, canDelete: true,
    description: "Private. Addresses are never shown on the website.",
    fields: [
      { name: "label", label: "Name", required: true }, { name: "contact_name", label: "Contact" },
      { name: "address_1", label: "Address 1", wide: true }, { name: "address_2", label: "Address 2", wide: true }, { name: "address_3", label: "Address 3", wide: true },
      { name: "city", label: "City" }, { name: "state", label: "State" }, { name: "postal_code", label: "ZIP / postal code" }, { name: "country", label: "Country" },
      { name: "phone", label: "Phone", type: "tel" }, { name: "mobile", label: "Mobile", type: "tel" },
      { name: "is_main", label: "Main address", type: "checkbox" }, { name: "is_billing", label: "Billing address", type: "checkbox" }, { name: "is_loan_out", label: "Loan-out", type: "checkbox" },
    ],
    columns: [{ key: "label", label: "Name" }, { key: "address_1", label: "Address" }, { key: "city", label: "City" }, { key: "country", label: "Country" }, { key: "is_main", label: "Main", format: "bool" }, { key: "is_billing", label: "Billing", format: "bool" }],
  },
  contacts: {
    title: "Related contacts", singular: "contact", canUpdate: true, canDelete: true,
    description: "Parents, guardians, managers, agents, and emergency contacts. Private.",
    fields: [
      { name: "name", label: "Name", required: true }, { name: "relationship", label: "Relationship", type: "select", options: relationshipOptions },
      { name: "email", label: "Email", type: "email" }, { name: "phone", label: "Phone", type: "tel" }, { name: "mobile", label: "Mobile", type: "tel" },
      { name: "notes", label: "Notes", type: "textarea", wide: true },
    ],
    columns: [{ key: "name", label: "Name" }, { key: "relationship", label: "Relationship" }, { key: "email", label: "Email" }, { key: "mobile", label: "Mobile" }],
  },
  "contact-methods": {
    title: "Phone numbers & emails", singular: "phone or email", canUpdate: true, canDelete: true,
    fields: [
      { name: "kind", label: "Type", type: "select", required: true, options: [{ value: "mobile", label: "Mobile" }, { value: "phone", label: "Phone" }, { value: "email", label: "Email" }] },
      { name: "value", label: "Number or email", required: true }, { name: "label", label: "Description" },
      { name: "is_default", label: "Default", type: "checkbox" }, { name: "add_to_cc", label: "Add to CC", type: "checkbox" },
    ],
    columns: [{ key: "kind", label: "Type" }, { key: "value", label: "Value" }, { key: "label", label: "Description" }, { key: "is_default", label: "Default", format: "bool" }, { key: "add_to_cc", label: "CC", format: "bool" }],
  },
  rates: {
    title: "Rates", singular: "rate", canUpdate: true, canDelete: true,
    fields: [{ name: "rate_type", label: "Type", required: true, hint: "e.g. Half day, Editorial" }, { name: "amount", label: "Rate", type: "number", required: true }, { name: "currency", label: "Currency", hint: "3-letter code" }, { name: "notes", label: "Notes", wide: true }],
    columns: [{ key: "rate_type", label: "Type" }, { key: "amount", label: "Rate", format: "money" }, { key: "currency", label: "Currency" }],
  },
  social: {
    title: "Social media", singular: "account", canUpdate: true, canDelete: true,
    fields: [{ name: "platform", label: "Platform", required: true, list: "social-platforms" }, { name: "handle", label: "Username" }, { name: "url", label: "URL", type: "url", wide: true }, { name: "follower_count", label: "Followers", type: "number" }, { name: "updated_on", label: "Date updated", type: "date" }],
    columns: [{ key: "platform", label: "Platform" }, { key: "handle", label: "Username" }, { key: "follower_count", label: "Followers", format: "number" }, { key: "updated_on", label: "Updated", format: "date" }],
  },
  skills: {
    title: "Skills", singular: "skill", canUpdate: true, canDelete: true,
    description: "Mark a skill public to show it on the website profile.",
    fields: [{ name: "category", label: "Category", required: true, list: "skill-categories" }, { name: "skill", label: "Skill", required: true, list: "skill-names" }, { name: "level", label: "Level", type: "select", options: ["Beginner", "Intermediate", "Advanced", "Professional", "Native"].map((value) => ({ value, label: value })) }, { name: "notes", label: "Notes", wide: true }, { name: "is_public", label: "Show on website", type: "checkbox" }],
    columns: [{ key: "category", label: "Category" }, { key: "skill", label: "Skill" }, { key: "level", label: "Level" }, { key: "is_public", label: "Public", format: "bool" }],
  },
  agencies: {
    title: "Agencies", singular: "agency relationship", canUpdate: true, canDelete: true,
    fields: [
      { name: "agency_name", label: "Agency", required: true, list: "agency-names", hint: "Pick an existing agency or type a new one." }, { name: "placement", label: "Placement" },
      { name: "country", label: "Country" }, { name: "city", label: "City" }, { name: "phone", label: "Phone", type: "tel" },
      { name: "mother_agency", label: "Mother agency", type: "checkbox" }, { name: "mother_agency_percent", label: "Mother agency %", type: "number" }, { name: "other_mother_agency", label: "Other mother agency" },
      { name: "contract_received", label: "Contract received", type: "checkbox" }, { name: "assigned_on", label: "Assigned on", type: "date" },
      { name: "start_date", label: "Start date", type: "date" }, { name: "end_date", label: "End date", type: "date" }, { name: "notes", label: "Notes", type: "textarea", wide: true },
    ],
    columns: [{ key: "agency_name", label: "Agency" }, { key: "country", label: "Country" }, { key: "placement", label: "Placement" }, { key: "mother_agency", label: "Mother", format: "bool" }, { key: "start_date", label: "Start", format: "date" }, { key: "end_date", label: "End", format: "date" }],
  },
  measurements: {
    title: "Measurement history", singular: "measurement snapshot", canDelete: true,
    description: "Each save adds a dated snapshot; history is never overwritten. Enter metric values; imperial is shown alongside.",
    fields: [
      { name: "measured_on", label: "Measured on", type: "date", required: true }, { name: "is_official", label: "Official measurements", type: "checkbox", hint: "Unchecked = current / true measurements." },
      { name: "height_cm", label: "Height (cm)", type: "number" }, { name: "bust_chest_cm", label: "Chest / bust (cm)", type: "number" }, { name: "waist_cm", label: "Waist (cm)", type: "number" }, { name: "hips_cm", label: "Hips (cm)", type: "number" },
      { name: "shoe_size_us", label: "Shoe (US)" }, { name: "shoe_size_custom", label: "Custom shoe size" }, { name: "suit_size", label: "Suit" }, { name: "suit_length", label: "Suit length" },
      { name: "inseam_cm", label: "Inseam (cm)", type: "number" }, { name: "outseam_cm", label: "Outseam (cm)", type: "number" }, { name: "sleeve_cm", label: "Sleeve (cm)", type: "number" },
      { name: "head_cm", label: "Head (cm)", type: "number" }, { name: "collar_cm", label: "Collar (cm)", type: "number" }, { name: "gloves", label: "Gloves" }, { name: "weight_kg", label: "Weight (kg)", type: "number" },
      { name: "eye_color", label: "Eye color", list: "eye-colors" }, { name: "hair_color", label: "Hair color", list: "hair-colors" }, { name: "hair_length", label: "Hair length" }, { name: "hair_type", label: "Hair type" },
      { name: "body_type", label: "Body type" }, { name: "ethnicity", label: "Ethnicity" }, { name: "notes", label: "Notes", type: "textarea", wide: true },
    ],
    columns: [{ key: "measured_on", label: "Date", format: "date" }, { key: "is_official", label: "Official", format: "bool" }, { key: "height_cm", label: "Height", format: "height" }, { key: "bust_chest_cm", label: "Chest/Bust", format: "length" }, { key: "waist_cm", label: "Waist", format: "length" }, { key: "hips_cm", label: "Hips", format: "length" }, { key: "shoe_size_us", label: "Shoe" }, { key: "eye_color", label: "Eyes" }, { key: "hair_color", label: "Hair" }],
  },
  notes: {
    title: "Internal notes", singular: "note", canDelete: true,
    description: "Staff-only. Never shown on the website.",
    fields: [{ name: "note_type", label: "Type", type: "select", options: ["internal", "booking", "scouting", "development", "other"].map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) })) }, { name: "body", label: "Note", type: "textarea", required: true, wide: true }],
    columns: [{ key: "created_at", label: "Added", format: "datetime" }, { key: "note_type", label: "Type" }, { key: "body", label: "Note" }],
  },
  items: {
    title: "Items", singular: "item", canUpdate: true, canDelete: true,
    fields: [{ name: "item_type", label: "Item", required: true }, { name: "description", label: "Description", wide: true }, { name: "size", label: "Size" }, { name: "condition", label: "Condition" }, { name: "status", label: "Status" }],
    columns: [{ key: "item_type", label: "Item" }, { key: "description", label: "Description" }, { key: "size", label: "Size" }, { key: "status", label: "Status" }],
  },
  usages: {
    title: "Usage", singular: "usage record", canUpdate: true, canDelete: true,
    fields: [
      { name: "event_type", label: "Event type" }, { name: "usage_type", label: "Usage type" }, { name: "client", label: "Client" }, { name: "product", label: "Product" },
      { name: "start_date", label: "Start date", type: "date" }, { name: "end_date", label: "End date", type: "date" }, { name: "booker", label: "Booker" }, { name: "exclusivity", label: "Exclusivity" },
      { name: "board", label: "Board" }, { name: "notes", label: "Notes", type: "textarea", wide: true },
    ],
    columns: [{ key: "client", label: "Client" }, { key: "product", label: "Product" }, { key: "usage_type", label: "Usage" }, { key: "start_date", label: "Start", format: "date" }, { key: "end_date", label: "End", format: "date" }, { key: "exclusivity", label: "Exclusivity" }],
  },
  appointments: {
    title: "Appointments", singular: "appointment", canUpdate: true, canDelete: true,
    fields: [
      { name: "event_type", label: "Event type" }, { name: "job_type", label: "Job type" }, { name: "client", label: "Client" }, { name: "product", label: "Product" },
      { name: "start_at", label: "Starts", type: "datetime-local" }, { name: "end_at", label: "Ends", type: "datetime-local" }, { name: "status", label: "Status" }, { name: "booker", label: "Booker" },
      { name: "board", label: "Board" }, { name: "cancelled", label: "Cancelled", type: "checkbox" }, { name: "notes", label: "Status notes", type: "textarea", wide: true },
    ],
    columns: [{ key: "start_at", label: "Starts", format: "datetime" }, { key: "event_type", label: "Event" }, { key: "client", label: "Client" }, { key: "status", label: "Status" }, { key: "cancelled", label: "Cancelled", format: "bool" }],
  },
} satisfies Record<string, ModuleUi>;

export type ListModule = keyof typeof moduleUi;

const identification: FieldDef[] = [
  { name: "passport_number", label: "Passport number" }, { name: "passport_country", label: "Passport country" }, { name: "passport_requested_on", label: "Passport requested", type: "date" },
  { name: "passport_issued_on", label: "Passport issued", type: "date" }, { name: "passport_expires_on", label: "Passport expires", type: "date" },
  { name: "visa_type", label: "Visa" }, { name: "visa_expires_on", label: "Visa expires", type: "date" },
  { name: "driver_license_number", label: "Driver license" }, { name: "driver_license_state", label: "License state" }, { name: "driver_license_expires_on", label: "License expires", type: "date" },
];

export const singletonUi = {
  legal: {
    title: "Legal, tax & contracts",
    fields: [
      { name: "legal_first_name", label: "Legal first name" }, { name: "legal_middle_name", label: "Legal middle name" }, { name: "legal_last_name", label: "Legal last name" }, { name: "company_name", label: "Company name" },
      { name: "non_resident", label: "Non-resident", type: "checkbox" }, { name: "freelancer", label: "Freelancer / entrepreneur", type: "checkbox" }, { name: "own_tax_responsible", label: "Own tax responsible", type: "checkbox" },
      { name: "tax_number", label: "Tax number" }, { name: "accounting_number", label: "Accounting number" }, { name: "insurance_number", label: "Insurance number" },
      { name: "talent_tax_percent", label: "Talent tax %", type: "number" }, { name: "talent_commission_percent", label: "Talent commission %", type: "number" },
      { name: "account_balance", label: "Account balance", type: "number" }, { name: "reserve_amount", label: "Reserve amount", type: "number" }, { name: "credit_status", label: "Credit status" },
      { name: "contract_name", label: "Contract name" }, { name: "contract_signed_on", label: "Signed on", type: "date" }, { name: "contract_returned", label: "Contract returned", type: "checkbox" }, { name: "contract_expires_on", label: "Contract expires", type: "date" },
      { name: "work_permit_number", label: "Work permit number" }, { name: "work_permit_country", label: "Work permit country" }, { name: "work_permit_issued_on", label: "Permit issued", type: "date" }, { name: "work_permit_expires_on", label: "Permit expires", type: "date" },
      { name: "stop_payments", label: "Stop payments", type: "checkbox" }, { name: "stop_payments_notes", label: "Stop payments notes", type: "textarea", wide: true },
    ] as FieldDef[],
  },
  identification: { title: "Passport, visa & identification", fields: identification },
  banking: {
    title: "Banking",
    fields: [
      { name: "description", label: "Description", wide: true }, { name: "contact", label: "Contact" }, { name: "account_name", label: "Account name" },
      { name: "account_number", label: "Account number", hint: "Leave blank to keep the saved value." }, { name: "routing_number", label: "Routing number", hint: "Leave blank to keep the saved value." },
      { name: "swift_aba", label: "SWIFT / ABA", hint: "Leave blank to keep the saved value." },
    ] as FieldDef[],
  },
  medical: {
    title: "Medical",
    fields: [
      { name: "doctor", label: "Doctor" }, { name: "office_phone", label: "Office phone", type: "tel" }, { name: "office_address", label: "Office address", wide: true },
      { name: "last_visit", label: "Last visit", type: "date" }, { name: "medical_approval", label: "Medical approval" }, { name: "valid_through", label: "Valid through", type: "date" },
      { name: "last_image_date", label: "Last image date", type: "date" }, { name: "availability", label: "Availability" }, { name: "medical_notes", label: "Medical notes", type: "textarea", wide: true },
    ] as FieldDef[],
  },
} satisfies Record<string, { title: string; fields: FieldDef[] }>;

export type SingletonKey = keyof typeof singletonUi;
