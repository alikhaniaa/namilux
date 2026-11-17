import type { FaqItem, PageView } from "@namilux/core/client";
import { PageBody } from "./PageBody";
import { Accordion } from "@/components/ui/Accordion";
import { RichHtml } from "@/components/ui/RichHtml";
import { t } from "@/i18n";

// DECISION: the header writes `Faq[]`, but the rows come from `getFaqs` (the spec §content), which
// returns `FaqItem` - the read model with `group`/`answerText`. `Faq` is the admin CRUD row
// (`groupKey`, `isActive`), and a storefront page never sees an inactive item. Typed `FaqItem` so
// the loader's result flows in without a cast.
export function FaqPage({
  page,
  groups,
}: {
  page: PageView;
  groups: { key: string; title: string; items: FaqItem[] }[];
}): React.ReactNode {
  // A group with nothing active in it is not a heading over an empty box - it is not a group.
  const filled = groups.filter((g) => g.items.length > 0);

  return (
    <>
      {/* the spec: PageBody owns the single <h1>; the JSON-LD FAQPage block is emitted by the
          route, which is the only place that knows the canonical path. */}
      <PageBody page={page} />

      {filled.length === 0 ? null : (
        <div className="wrap section grid gap-7">
          {filled.map((group) => (
            <section key={group.key} className="grid gap-3">
              {/* The group title is data; `page.faq.title` stays the label of the whole page. */}
              <h2 className="d-3">{group.title === "" ? t("page.faq.title") : group.title}</h2>
              <Accordion
                items={group.items.map((item) => ({
                  id: String(item.id),
                  title: item.question,
                  // The answer is DB HTML: it can only reach the DOM through the sanitizing sink,
                  // and it stays in the DOM while collapsed so a crawler reads it.
                  content: <RichHtml html={item.answerHtml} />,
                }))}
              />
            </section>
          ))}
        </div>
      )}
    </>
  );
}
