import Link from "next/link";
import { notFound } from "next/navigation";
import { AuthShell, authButton } from "@/app/login/AuthShell";
import { DEMO_MODE } from "@/lib/demo";

export const metadata = { title: "Join us (demo)", robots: { index: false } };

// Demo mode only: where "Join us" leads. The live site sends applicants to the
// agency's own application form; a demo visitor must never be able to submit a
// real application, so the step is explained here instead.
export default function DemoJoinPage() {
  if (!DEMO_MODE) notFound();
  return <AuthShell eyebrow="Demo mode" title="Applications are simulated." intro="On the live site, “Join us” opens the agency’s application form. Each submission arrives in the dashboard’s Applications queue, where staff review it, add notes and convert approved applicants into talent records.">
    <div className="mt-8 space-y-3">
      <Link href="/demo?as=talent_manager" prefetch={false} className={`${authButton} block text-center`}>See the applications queue</Link>
      <p className="text-center text-[11px] leading-5 text-[#6b6d66]">Opens the dashboard as the sample talent manager. The queue already holds sample applications in every stage.</p>
    </div>
  </AuthShell>;
}
