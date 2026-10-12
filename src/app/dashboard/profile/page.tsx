import { Card, PageHeader } from "@/components/ui/PageHeader";
import { UnauthorizedState } from "@/components/ui/States";
import { displayNameForUser, requirePage } from "@/lib/agency-auth";
import { ChangePasswordForm, ProfilePhotoForm } from "@/features/team/ProfileForms";
import { profilePhotoUrl } from "@/features/team/photo";

export const metadata = { title: "My profile" };

// Every team member's own account: profile photo and password. Name and role are
// set by the owner in Settings → Team access.
export default async function ProfilePage() {
  const context = await requirePage();
  if (!context?.user || !context.membership) return <UnauthorizedState />;
  const { user, membership } = context;
  const name = displayNameForUser(user, context.profile);
  const usesGoogle = (user.identities ?? []).some((identity) => identity.provider === "google");

  return <div className="max-w-3xl space-y-6">
    <PageHeader eyebrow="Account" title="My profile" description="Your photo appears in the dashboard menu." />
    <Card title="Profile photo">
      <ProfilePhotoForm userId={user.id} name={name} photoUrl={profilePhotoUrl(user.user_metadata)} />
    </Card>
    <Card title="Account">
      <dl className="grid gap-4 text-sm sm:grid-cols-3">
        <div><dt className="text-[10px] font-800 uppercase tracking-[.14em] text-[#6f716b]">Name</dt><dd className="mt-1">{name}</dd></div>
        <div className="min-w-0"><dt className="text-[10px] font-800 uppercase tracking-[.14em] text-[#6f716b]">Email</dt><dd className="mt-1 truncate">{user.email}</dd></div>
        <div><dt className="text-[10px] font-800 uppercase tracking-[.14em] text-[#6f716b]">Role</dt><dd className="mt-1 capitalize">{membership.role.replace("_", " ")}</dd></div>
      </dl>
      <p className="mt-4 text-[11px] text-[#6b6d66]">To change your name or role, ask the owner.</p>
    </Card>
    <Card title="Password" description={usesGoogle ? "You can also keep signing in with Google." : undefined}>
      <ChangePasswordForm />
    </Card>
  </div>;
}
