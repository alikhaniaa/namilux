import Link from "next/link";
import { thumbUrl } from "@/lib/media";
import type { MediaGridRow } from "./MediaGrid";
import { Card, StatusBadge } from "@/components/kit";
import { fa } from "@/i18n/fa";
import { quarantineReasonFa } from "@/lib/quarantine-reason";

export function NormalizationQa({ items }: { items: MediaGridRow[] }) {
  return (
    <Card title={fa["media.qa.title"]}>
      {items.length === 0 ? (
        <p className="text-xs text-[var(--ink-2)]">{fa["media.qa.empty"]}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
          {items.map((m) => (
            <li key={m.id} className="border border-[var(--line)] p-1">
              <Link href={`/media/${m.id}`}>
                <span className="block aspect-square bg-[var(--plate)]">
                  <img src={thumbUrl(m)} alt={m.alt} className="h-full w-full object-contain" loading="lazy" />
                </span>
              </Link>
              <p className="mt-1 text-[11px]">
                <StatusBadge tone="warn">{fa["media.reason"]}</StatusBadge>
                {/* Persian, and not `ltr`: the reason is a sentence now, not an English diagnostic. */}
                <span className="ms-1">{quarantineReasonFa(m.reason) ?? fa["common.none"]}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
