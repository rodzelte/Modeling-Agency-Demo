import { AuthShell } from "../AuthShell";
import { ForgotForm } from "./ForgotForm";

export const metadata = { title: "Reset password", robots: { index: false } };

export default function ForgotPasswordPage() {
  return <AuthShell eyebrow="Account recovery" title="Reset your password." intro="Enter the email you sign in with. If it belongs to an agency account, we will email you a link to choose a new password.">
    <ForgotForm />
  </AuthShell>;
}
