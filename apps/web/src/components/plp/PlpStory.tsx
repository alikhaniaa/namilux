import { DescriptionToggle } from "@/components/product/DescriptionToggle";
import { RichHtml } from "@/components/ui/RichHtml";
import { t } from "@/i18n";

export function PlpStory({ title, html }: { title: string; html: string | null | undefined }): React.ReactNode {
  if (html == null || html.trim() === "") return null;
  return (
    <section className="plp-story">
      <div className="wrap plp-story__inner">
        <h2 className="plp-story__title">{t("plp.about", { name: title })}</h2>
        <DescriptionToggle>
          <RichHtml html={html} />
        </DescriptionToggle>
      </div>
    </section>
  );
}
