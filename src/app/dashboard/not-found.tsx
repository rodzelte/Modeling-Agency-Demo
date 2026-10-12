import Link from "next/link";
import { EmptyState } from "@/components/ui/States";

export default function DashboardNotFound() {
  return <div className="space-y-4">
    <EmptyState title="Not found">This record does not exist, was removed, or you do not have access to it.</EmptyState>
    <p className="text-center"><Link href="/dashboard" className="text-xs font-700 text-[#5f615b] underline-offset-4 hover:underline">Back to the dashboard</Link></p>
  </div>;
}
