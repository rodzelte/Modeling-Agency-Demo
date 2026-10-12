// The fictional people a demo visitor can sign in as. Safe to import anywhere:
// these exist only in the sandbox and are never created in a real project.
// supabase/demo/seed.sql gives each address its agency_members row.
export type DemoAccount = {
  key: string;
  id: string;
  email: string;
  name: string;
  role: string;
  label: string;
  blurb: string;
  area: "dashboard" | "portal";
};

// Not a secret: the demo sign-in screen offers every account with one click.
export const DEMO_PASSWORD = "demo-access-42";

export const DEMO_ACCOUNTS: DemoAccount[] = [
  { key: "owner", id: "d0000000-0000-4000-8000-000000000001", email: "olivia.hart@northlight-demo.example", name: "Olivia Hart", role: "owner", label: "Owner", blurb: "Everything, including settings, team and finance", area: "dashboard" },
  { key: "administrator", id: "d0000000-0000-4000-8000-000000000002", email: "marcus.bell@northlight-demo.example", name: "Marcus Bell", role: "administrator", label: "Administrator", blurb: "Runs the workspace day to day", area: "dashboard" },
  { key: "booker", id: "d0000000-0000-4000-8000-000000000003", email: "priya.nair@northlight-demo.example", name: "Priya Nair", role: "booker", label: "Booker", blurb: "Bookings, calendar, clients and packages", area: "dashboard" },
  { key: "talent_manager", id: "d0000000-0000-4000-8000-000000000004", email: "daniel.okafor@northlight-demo.example", name: "Daniel Okafor", role: "talent_manager", label: "Talent manager", blurb: "Talent records, applications and requests", area: "dashboard" },
  { key: "creative", id: "d0000000-0000-4000-8000-000000000005", email: "sofia.marin@northlight-demo.example", name: "Sofia Marin", role: "creative", label: "Creative", blurb: "Photos, portfolios and comp cards", area: "dashboard" },
  { key: "accounting", id: "d0000000-0000-4000-8000-000000000006", email: "henry.cole@northlight-demo.example", name: "Henry Cole", role: "accounting", label: "Accounting", blurb: "Fees, invoices and payouts", area: "dashboard" },
  { key: "read_only", id: "d0000000-0000-4000-8000-000000000007", email: "grace.lindqvist@northlight-demo.example", name: "Grace Lindqvist", role: "read_only", label: "Read only", blurb: "Can look, cannot change anything", area: "dashboard" },
  { key: "talent", id: "d0000000-0000-4000-8000-000000000008", email: "amara.cole@talent-demo.example", name: "Amara Cole", role: "talent", label: "Talent (portal)", blurb: "What a signed model sees in their own portal", area: "portal" },
];

export function demoAccount(key: string | null | undefined): DemoAccount | undefined {
  return DEMO_ACCOUNTS.find((account) => account.key === key);
}
