import { requireStaff } from "@/lib/session";
import { ChangePasswordForm } from "./ChangePasswordForm";

/**
 * The forced first-login password change. It lives OUTSIDE the `(admin)` group on purpose: the
 * admin layout bounces every staff member whose `must_change_password` flag is set to this screen,
 * so a page inside that group would redirect to itself. There is no shell here - the same
 * two-panel frame as /login and /login/totp - because until the password is changed there is
 * nothing else this account may open.
 */
export default async function ChangePasswordPage() {
  const staff = await requireStaff();
  return <ChangePasswordForm forced={staff.mustChangePassword} />;
}
