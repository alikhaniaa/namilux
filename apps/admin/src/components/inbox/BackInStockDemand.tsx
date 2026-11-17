import Link from "next/link";
import { faInt, formatRelative } from "@namilux/core";
import { EmptyRow, Table, Td, Th } from "@/components/kit";
import { fa } from "@/i18n/fa";

export function BackInStockDemand({ items }: { items: { productId: number; displayName: string; waiting: number; oldest: string }[] }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>{fa["inbox.product"]}</Th>
          <Th>{fa["inbox.waiting"]}</Th>
          <Th>{fa["inbox.oldest"]}</Th>
        </tr>
      </thead>
      <tbody>
        {items.map((r) => (
          <tr key={r.productId} className="border-t border-[var(--line)]">
            <Td>
              <Link href={`/products/${String(r.productId)}?tab=price`} className="hover:text-[var(--accent)]">
                {r.displayName}
              </Link>
            </Td>
            <Td className="tabular-nums">{faInt(r.waiting)}</Td>
            <Td className="text-xs text-[var(--ink-2)]">{formatRelative(r.oldest)}</Td>
          </tr>
        ))}
        {items.length === 0 ? <EmptyRow colSpan={3} text={fa["inbox.empty"]} /> : null}
      </tbody>
    </Table>
  );
}
