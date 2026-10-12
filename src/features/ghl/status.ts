// Normalized CRM status for a GHL contact, derived from real GHL data only:
// pipeline stage mappings, opportunity status, and optional tag / contact-field
// rules, all of which staff configure in Dashboard → GHL Sync. Pure: unit tested.

export const CRM_STATUSES = ["lead", "applicant", "screening", "accepted", "enrolled", "active", "booked", "graduated", "inactive", "rejected", "archived"] as const;
export type CrmStatus = (typeof CRM_STATUSES)[number];

export const CRM_STATUS_LABELS: Record<CrmStatus, string> = {
  lead: "Lead", applicant: "Applicant", screening: "Screening", accepted: "Accepted", enrolled: "Enrolled", active: "Active",
  booked: "Booked", graduated: "Graduated", inactive: "Inactive", rejected: "Rejected", archived: "Archived",
};

// Higher wins among "live" statuses. Ending statuses only apply when nothing live remains.
const LIVE_RANK: Partial<Record<CrmStatus, number>> = { active: 9, booked: 8, enrolled: 7, graduated: 6, accepted: 5, screening: 4, applicant: 3, lead: 2 };
const ENDING = new Set<CrmStatus>(["inactive", "rejected", "archived"]);

export function isCrmStatus(value: unknown): value is CrmStatus {
  return typeof value === "string" && (CRM_STATUSES as readonly string[]).includes(value);
}

export type StatusPipeline = { id: string; purpose: "talent" | "client" | "ignore" | null; badge_label: string | null; name: string };
export type StatusStage = { id: string; name: string; normalized_status: CrmStatus | null };
export type StatusOpportunity = { pipeline_id: string; stage_id: string | null; status: string | null; changed_at: string | null };
export type StatusRule = { kind: "tag" | "contact_field"; field_id: string | null; match_value: string; normalized_status: CrmStatus };

export type StatusInput = {
  opportunities: StatusOpportunity[];
  tags: string[];
  customFields: Record<string, unknown>;
  pipelines: Map<string, StatusPipeline>;
  stages: Map<string, StatusStage>;
  rules: StatusRule[];
  talentStatuses: CrmStatus[];
};

type Contribution = { status: CrmStatus; reason: string; at: string; badge: string | null };

const fieldValues = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((item) => String(item).trim().toLowerCase()) : value === null || value === undefined ? [] : [String(value).trim().toLowerCase()];

export function deriveCrmStatus(input: StatusInput): { status: CrmStatus | null; reason: string | null; programs: string[] } {
  const contributions: Contribution[] = [];

  for (const opportunity of input.opportunities) {
    const pipeline = input.pipelines.get(opportunity.pipeline_id);
    if (pipeline?.purpose !== "talent") continue;
    const stage = opportunity.stage_id ? input.stages.get(opportunity.stage_id) : undefined;
    if (!stage?.normalized_status) continue;
    let status = stage.normalized_status;
    let reason = `${pipeline.name} → ${stage.name}`;
    // A lost or abandoned opportunity no longer counts as live progress.
    if ((opportunity.status === "lost" || opportunity.status === "abandoned") && !ENDING.has(status)) {
      status = "inactive";
      reason += ` (${opportunity.status})`;
    }
    contributions.push({ status, reason, at: opportunity.changed_at ?? "", badge: pipeline.badge_label });
  }

  const tags = new Set(input.tags.map((tag) => tag.trim().toLowerCase()));
  for (const rule of input.rules) {
    const match = rule.match_value.trim().toLowerCase();
    if (rule.kind === "tag" && tags.has(match)) contributions.push({ status: rule.normalized_status, reason: `Tag "${rule.match_value}"`, at: "", badge: null });
    if (rule.kind === "contact_field" && rule.field_id && fieldValues(input.customFields[rule.field_id]).includes(match)) {
      contributions.push({ status: rule.normalized_status, reason: `Field value "${rule.match_value}"`, at: "", badge: null });
    }
  }

  const qualifying = new Set(input.talentStatuses);
  const programs = [...new Set(contributions.filter((item) => item.badge && qualifying.has(item.status)).map((item) => item.badge as string))].sort();

  const live = contributions.filter((item) => LIVE_RANK[item.status] !== undefined)
    .sort((a, b) => (LIVE_RANK[b.status] ?? 0) - (LIVE_RANK[a.status] ?? 0) || b.at.localeCompare(a.at));
  if (live.length) return { status: live[0].status, reason: live[0].reason, programs };
  const ended = contributions.filter((item) => ENDING.has(item.status)).sort((a, b) => b.at.localeCompare(a.at));
  if (ended.length) return { status: ended[0].status, reason: ended[0].reason, programs };
  return { status: null, reason: null, programs };
}
