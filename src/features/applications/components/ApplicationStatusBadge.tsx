import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { STATUS_LABELS, type ApplicationStatus } from "../queries";

const tones: Record<ApplicationStatus, BadgeTone> = {
  new: "internal", reviewing: "review", info_requested: "review", approved: "public", rejected: "inactive", archived: "archived", converted: "published",
};

export function ApplicationStatusBadge({ status }: { status: ApplicationStatus }) {
  return <Badge tone={tones[status] ?? "neutral"}>{STATUS_LABELS[status] ?? status}</Badge>;
}
