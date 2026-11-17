import { faDigits } from "@namilux/core/client";
import type { SpecGroup } from "@namilux/core/client";
import { Bdi } from "@/components/ui/Bdi";
import { t } from "@/i18n";

export function SpecTable({ groups }: { groups: SpecGroup[] }): React.ReactNode {
  const withRows = groups.filter((g) => g.rows.length > 0);
  if (withRows.length === 0) return null;

  // v2 §6.6: real table rows, never one fused «توان: ۱۵۰۰ وات · وزن: ۳ کیلوگرم» string - a spec a
  // shopper cannot scan is a spec they do not read.
  return (
    <div className="spec-grid">
      {withRows.map((group, gi) => (
        <table key={group.name ?? `g${String(gi)}`} className="spec-table">
          <caption>{group.name ?? t("product.specs")}</caption>
          <tbody>
            {group.rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                {/* Persian digits for numbers, and any Latin run (a model code, a unit like "W")
                    isolated so bidi cannot reorder it. */}
                <td>
                  <Bdi text={faDigits(row.value)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  );
}
