import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import { LoginForm } from "@/components/account/LoginForm";
import { t } from "@/i18n";
import { Icon } from "@/components/ui/Icon";

export const metadata: Metadata = { title: "ورود", robots: { index: false, follow: false } };

/** Only same-site absolute paths are honoured as `next` (open-redirect guard). */
function safeNext(raw: string | undefined): string {
  if (raw === undefined) return "/account/";
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return "/account/";
}

export default async function LoginRoute({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}): Promise<React.ReactNode> {
  const { next } = await searchParams;
  const target = safeNext(next);
  const user = await currentUser();
  if (user !== null) redirect(target);
  return (
    <section className="login">
      <span className="login__icon"><Icon name="user" size={24} /></span>
      {/* The account layout already owns the page <h1>; this is the section heading of the nested route. */}
      <h2 className="login__title">{t("account.login.title")}</h2>
      <p className="login__body">{t("account.login.body")}</p>
      <LoginForm next={target} />
      <p className="login__secure"><Icon name="shield" size={16} />{t("account.login.secure")}</p>
    </section>
  );
}
