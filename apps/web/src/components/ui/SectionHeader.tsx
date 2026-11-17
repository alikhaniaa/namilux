import Link from "next/link";
import { t } from "@/i18n";
import type { FaKey } from "@/i18n";

export function SectionHeader({
  title,
  href,
  linkLabel = "section.all",
  as = "h2",
  display = false,
}: {
  title: string;
  href?: string;
  linkLabel?: FaKey;
  as?: "h2" | "h3";
  display?: boolean;
}): React.ReactNode {
  const Heading = as;
  // the spec: the only ornament in the system is the brand square - a section heading is bare
  // type with the optional «همه» link sitting at the inline-end of the same row.
  return (
    <div className="section-head" data-reveal>
      <Heading className={display ? "d-1" : as === "h2" ? "d-2" : "d-3"}>{title}</Heading>
      {href === undefined ? null : (
        <Link href={href} className="link-under t-sm shrink-0">
          {t(linkLabel)}
        </Link>
      )}
    </div>
  );
}
