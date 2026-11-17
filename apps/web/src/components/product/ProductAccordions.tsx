import type { FaqItem } from "@namilux/core/client";
import { Accordion } from "@/components/ui/Accordion";
import { RichHtml } from "@/components/ui/RichHtml";
import { t } from "@/i18n";

export function ProductAccordions({
  shippingHtml,
  warrantyHtml,
  faqs,
}: {
  shippingHtml?: string | null;
  warrantyHtml?: string | null;
  faqs: FaqItem[];
}): React.ReactNode {
  const items: { id: string; title: string; content: React.ReactNode }[] = [];

  // Only a section that has something to say appears - an empty «گارانتی و خدمات» row that opens
  // onto nothing reads as a broken page, not as a reassurance.
  if (shippingHtml != null && shippingHtml !== "") {
    items.push({ id: "shipping", title: t("product.acc.shipping"), content: <RichHtml html={shippingHtml} /> });
  }
  if (warrantyHtml != null && warrantyHtml !== "") {
    items.push({ id: "warranty", title: t("product.acc.warranty"), content: <RichHtml html={warrantyHtml} /> });
  }
  if (faqs.length > 0) {
    items.push({
      id: "faq",
      title: t("product.acc.faq"),
      content: (
        <dl className="grid gap-4">
          {faqs.map((f) => (
            <div key={f.id}>
              <dt className="t-body font-semibold">{f.question}</dt>
              <dd>
                <RichHtml html={f.answerHtml} />
              </dd>
            </div>
          ))}
        </dl>
      ),
    });
  }

  if (items.length === 0) return null;
  // The section padding lives here so a product with nothing to fold leaves no blank band behind.
  return (
    <div className="wrap section">
      <Accordion items={items} />
    </div>
  );
}
