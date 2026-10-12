import Link from "next/link";
import { Plus } from "lucide-react";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { Card, PageHeader } from "@/components/ui/PageHeader";
import { formatDate, formatDateTime } from "@/lib/format";
import type { PermissionSet } from "@/lib/permissions";
import { describeAction } from "./activity";
import { BookingList } from "@/features/operations/components/BookingList";
import type { loadOverview } from "./overview";

export type OverviewData = Awaited<ReturnType<typeof loadOverview>>;

type Ref = { id: string; display_name: string } | null;
const one = (value: unknown) => (Array.isArray(value) ? value[0] : value) as Ref;

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-xs text-[#717369]">{children}</p>;
}

function TalentLink({ talent }: { talent: Ref }) {
  return talent ? <Link href={`/dashboard/talent/${talent.id}`} className="font-700 hover:text-[#a4502f]">{talent.display_name}</Link> : <span className="text-[#717369]">Unknown talent</span>;
}

function Row({ children }: { children: React.ReactNode }) {
  return <li className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 py-2.5 [&>*:first-child]:min-w-0 [&>*:first-child]:break-words">{children}</li>;
}

const meta = "shrink-0 text-right text-xs text-[#6b6d66]";

export function OverviewView({ name, permissions, data }: { name: string; permissions: PermissionSet; data: OverviewData }) {
  return <div className="space-y-8">
    <PageHeader eyebrow="42 Model Management" title={`Welcome back, ${name}.`} description="Live figures from the talent database. Sections appear according to your role."
      actions={permissions.has("talent.create") ? <ButtonLink href="/dashboard/talent/new" icon={<Plus size={14} />}>New talent</ButtonLink> : null} />

    {data.metrics && <section aria-label="Talent totals" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {([
        ["Active talent", data.metrics.active, "/dashboard/talent", "Not archived"],
        ["Live on website", data.metrics.live, "/dashboard/talent?status=website", "Published and visible"],
        ["In review", data.metrics.inReview, "/dashboard/talent?status=review", "Awaiting a decision"],
        ["Drafts", data.metrics.drafts, "/dashboard/talent?status=draft", "Not yet submitted"],
      ] as const).map(([label, value, href, hint]) => <Link key={label} href={href} className="group rounded-xl border border-[#e7e7e3] bg-white p-5 transition-colors hover:border-[#20211f] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#a4502f]">
        <p className="text-[10px] font-800 uppercase tracking-[.14em] text-[#6b6d66]">{label}</p>
        <p className="mt-3 text-4xl font-700 tabular-nums tracking-[-.04em]">{value}</p>
        <p className="mt-1 text-[11px] text-[#717369] group-hover:text-[#6f716b]">{hint}</p>
      </Link>)}
    </section>}

    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
      {data.bookings && <Card title="Upcoming bookings" actions={<Link href="/dashboard/calendar" className="text-[10px] font-800 uppercase tracking-[.14em] text-[#6b6d66] hover:text-[#20211f]">Calendar</Link>}>
        <BookingList rows={data.bookings} empty="Nothing booked yet." />
      </Card>}

      {data.tasks && data.tasks.length > 0 && <Card title="My tasks" actions={<Link href="/dashboard/tasks" className="text-[10px] font-800 uppercase tracking-[.14em] text-[#6b6d66] hover:text-[#20211f]">All tasks</Link>}>
        <ul className="divide-y divide-[#f3f3f0] text-sm">{data.tasks.map((task) => <Row key={task.id}><span className={task.priority === "high" ? "font-700" : ""}>{task.title}</span><span className={`${meta} ${task.due_on && task.due_on < new Date().toISOString().slice(0, 10) ? "font-700 text-[#a9593d]" : ""}`}>{task.due_on ? formatDate(task.due_on) : "No due date"}</span></Row>)}</ul>
      </Card>}

      {data.applications && <Card title={`New applications${data.applications.total ? ` (${data.applications.total})` : ""}`} description="Join Us submissions from GoHighLevel awaiting review."
        actions={<Link href="/dashboard/applications" className="text-[10px] font-800 uppercase tracking-[.14em] text-[#6b6d66] hover:text-[#20211f]">View all</Link>}>
        {data.applications.latest.length ? <ul className="divide-y divide-[#f3f3f0] text-sm">{data.applications.latest.map((item) => <Row key={item.id}>
          <span><Link href={`/dashboard/applications/${item.id}`} className="font-700 hover:text-[#a4502f]">{[item.first_name, item.last_name].filter(Boolean).join(" ") || item.email || "Applicant"}</Link>
            <span className="block text-xs text-[#6b6d66]">{[item.city, item.is_minor ? "Minor" : null].filter(Boolean).join(" · ") || "—"}</span></span>
          <span className={meta}>{formatDate(item.submitted_at)}</span>
        </Row>)}</ul> : <Empty>No new applications.</Empty>}
      </Card>}

      {data.websiteDrafts && data.websiteDrafts.length > 0 && <Card title="Website drafts" description="Pages with changes that are not live yet."
        actions={<Link href="/dashboard/website" className="text-[10px] font-800 uppercase tracking-[.14em] text-[#6b6d66] hover:text-[#20211f]">Website</Link>}>
        <ul className="divide-y divide-[#f3f3f0] text-sm">{data.websiteDrafts.map((page) => <Row key={page.id}>
          <span><Link href={`/dashboard/website/pages/${page.id}`} className="font-700 hover:text-[#a4502f]">{page.title}</Link><span className="block text-xs text-[#6b6d66]">/{page.slug} · {page.status === "published" ? "live, with unpublished changes" : "draft"}</span></span>
          <span className={meta}>{formatDate(page.updated_at)}</span>
        </Row>)}</ul>
      </Card>}

      {permissions.has("talent.view") && <Card title="Pending review" description="Talent waiting for a publishing decision.">
        {data.review.length ? <ul className="divide-y divide-[#f3f3f0] text-sm">{data.review.map((talent) => <Row key={talent.id}><TalentLink talent={talent} /><span className={meta}>{formatDate(talent.updated_at)}</span></Row>)}</ul> : <Empty>Nothing is waiting for review.</Empty>}
      </Card>}

      {permissions.has("talent.view") && <Card title="Recently updated">
        {data.recent.length ? <ul className="divide-y divide-[#f3f3f0] text-sm">{data.recent.map((talent) => <Row key={talent.id}><TalentLink talent={talent} /><span className="flex shrink-0 items-center gap-3"><StatusBadge status={talent.publication_status} /><span className="text-xs text-[#6b6d66]">{formatDate(talent.updated_at)}</span></span></Row>)}</ul> : <Empty>No talent records yet.</Empty>}
      </Card>}

      {permissions.has("operations.view") && <Card title="Upcoming appointments" description="Next 14 days.">
        {data.appointments.length ? <ul className="divide-y divide-[#f3f3f0] text-sm">{data.appointments.map((item) => <Row key={item.id}><span><TalentLink talent={one(item.talent)} /><span className="block text-xs text-[#6b6d66]">{[item.event_type, item.client].filter(Boolean).join(" · ") || "Appointment"}</span></span><span className={meta}>{formatDateTime(item.start_at)}</span></Row>)}</ul> : <Empty>No appointments in the next two weeks.</Empty>}
      </Card>}

      {permissions.has("legal.view") && <Card title="Contracts, passports, visas & permits" description="Expired or expiring within 60 days.">
        {data.expiring.length ? <ul className="divide-y divide-[#f3f3f0] text-sm">{data.expiring.map((item, index) => <Row key={`${item.talent?.id}-${item.label}-${index}`}><span><TalentLink talent={item.talent} /><span className="block text-xs text-[#6b6d66]">{item.label}</span></span><span className="flex shrink-0 items-center gap-2 text-xs">{item.expired && <Badge tone="internal">Expired</Badge>}{formatDate(item.date)}</span></Row>)}</ul> : <Empty>Nothing expires in the next 60 days.</Empty>}
      </Card>}

      {permissions.has("talent.private.view") && <Card title="Upcoming birthdays" description="Next 30 days.">
        {data.birthdays.length ? <ul className="divide-y divide-[#f3f3f0] text-sm">{data.birthdays.map((item) => <Row key={item.talent?.id}><TalentLink talent={item.talent} /><span className={meta}>{item.days === 0 ? "Today" : formatDate(item.date, { month: "short", day: "numeric" })}</span></Row>)}</ul> : <Empty>No birthdays in the next 30 days.</Empty>}
      </Card>}

      {permissions.has("media.view") && <Card title="Recent uploads">
        {data.uploads.length ? <ul className="divide-y divide-[#f3f3f0] text-sm">{data.uploads.map((photo) => <Row key={photo.id}><span className="min-w-0"><TalentLink talent={one(photo.talent)} /><span className="block truncate text-xs text-[#6b6d66]">{photo.title || "Untitled image"}</span></span><span className={meta}>{formatDate(photo.created_at)}</span></Row>)}</ul> : <Empty>No media uploaded yet.</Empty>}
      </Card>}

      {permissions.has("audit.view") && <Card title="Recent activity" className="lg:col-span-2" actions={<Link href="/dashboard/settings?section=activity" className="text-[10px] font-800 uppercase tracking-[.14em] text-[#6b6d66] hover:text-[#20211f]">View all</Link>}>
        {data.activity.length ? <ul className="divide-y divide-[#f3f3f0] text-sm">{data.activity.map((event) => {
          const actor = (Array.isArray(event.actor) ? event.actor[0] : event.actor) as { full_name: string; email: string } | null;
          return <Row key={event.id}>
            <span><span className="font-700">{actor?.full_name || actor?.email || "System"}</span> <span className="text-[#5f615b]">{describeAction(event.action)}</span>
              {event.entity_type === "talent" && event.entity_id && <> · <Link href={`/dashboard/talent/${event.entity_id}`} className="text-[#6b6d66] underline-offset-2 hover:text-[#a4502f] hover:underline">view record</Link></>}
              {event.entity_type === "application" && event.entity_id && permissions.has("applications.view") && <> · <Link href={`/dashboard/applications/${event.entity_id}`} className="text-[#6b6d66] underline-offset-2 hover:text-[#a4502f] hover:underline">view application</Link></>}</span>
            <span className={meta}>{formatDateTime(event.created_at)}</span>
          </Row>;
        })}</ul> : <Empty>No activity recorded yet.</Empty>}
      </Card>}
    </div>
  </div>;
}
