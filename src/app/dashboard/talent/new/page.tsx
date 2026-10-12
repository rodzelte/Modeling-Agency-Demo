import { PageHeader } from "@/components/ui/PageHeader";
import { UnauthorizedState } from "@/components/ui/States";
import { requirePage } from "@/lib/agency-auth";
import { loadBoards } from "@/features/talent/queries";
import { NewTalentForm } from "@/features/talent/components/NewTalentForm";

export const metadata = { title: "New talent" };

export default async function NewTalentPage() {
  const context = await requirePage("talent.create");
  if (!context) return <UnauthorizedState />;
  const { flat } = await loadBoards(context.supabase);

  return <div className="space-y-6">
    <PageHeader eyebrow="Talent" title="New talent" description="Start a draft record. It stays private until it is published with website visibility enabled." />
    <NewTalentForm
      boards={flat.filter((board) => board.is_active).map((board) => ({ id: board.id, label: board.label, isPublic: board.isPublic }))}
      canSetDob={context.permissions.has("talent.private.edit")}
      canAssignBoards={context.permissions.has("boards.assign")}
    />
  </div>;
}
