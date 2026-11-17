import Link from "next/link";
import { t } from "@/i18n";

const SIZE = { sm: "22px", md: "28px", lg: "clamp(40px, 10vw, 96px)" } as const;

// Owner override (2026-08-31): use the supplied logoName.png wordmark, without recolouring or
// cropping the lettering. The accessible name remains real text; CSS reserves the layout box.
// Design audit 2 Sep 2026: `onLight` paints the same alpha lettering in --ink (a CSS mask) for the
// porcelain pages - 404, offline - where the light PNG used to vanish.
export function Wordmark({ size = "md", onLight = false }: { size?: "sm" | "md" | "lg"; onLight?: boolean }): React.ReactNode {
  return (
    <Link
      href="/"
      className={onLight ? "wordmark brand-logo brand-logo--ink" : "wordmark brand-logo"}
      aria-label={t("shell.wordmark")}
      style={{ fontSize: SIZE[size] }}
    >
      <span className="sr-only">{t("shell.wordmark")}</span>
    </Link>
  );
}
