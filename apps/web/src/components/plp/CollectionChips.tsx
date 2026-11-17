import { Chip } from "@/components/ui/Chip";
import { Rail } from "@/components/ui/Rail";
import { t } from "@/i18n";

export function CollectionChips({
  chips,
}: {
  chips: { href: string; label: string; count: number; current?: boolean }[];
}): React.ReactNode {
  if (chips.length === 0) return null;
  return (
    <Rail ariaLabel={t("plp.facet.collection")} itemWidth="chip">
      {chips.map((c) => (
        // Each chip is a real URL (F-008), so the rail is crawlable and a filtered view is shareable.
        <li key={c.href}>
          <Chip href={c.href} count={c.count} pressed={c.current === true}>
            {c.label}
          </Chip>
        </li>
      ))}
    </Rail>
  );
}
