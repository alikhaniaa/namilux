import { faInt } from "@namilux/core";
import { Card } from "@/components/kit";
import { fa } from "@/i18n/fa";

export function SitemapStatus({ counts, origin }: { counts: Record<string, number>; origin: string }) {
  return (
    <Card title={fa["seo.sitemap"]}>
      <table className="w-full text-sm">
        <thead className="text-xs text-[var(--ink-2)]">
          <tr>
            <th className="p-1 text-start">{fa["seo.sitemap.child"]}</th>
            <th className="p-1 text-start">{fa["seo.sitemap.count"]}</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(counts).map(([name, n]) => (
            <tr key={name} className="border-t border-[var(--line)]">
              <td className="p-1">
                <a className="ltr text-xs hover:text-[var(--accent)]" href={`${origin}/sitemaps/${name}.xml`} target="_blank" rel="noreferrer">
                  {({ products: "کالاها", categories: "دسته‌ها", brands: "برندها", collections: "مجموعه‌ها", posts: "مطالب", pages: "صفحه‌ها" })[name] ?? "سایر صفحه‌ها"}
                </a>
              </td>
              <td className="p-1 tabular-nums">{faInt(n)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <a className="mt-2 block ltr text-xs text-[var(--ink-2)] hover:text-[var(--accent)]" href={`${origin}/sitemap_index.xml`} target="_blank" rel="noreferrer">
        مشاهدهٔ نقشهٔ کامل سایت
      </a>
    </Card>
  );
}
