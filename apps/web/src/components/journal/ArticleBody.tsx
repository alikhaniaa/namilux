import { RichHtml } from "@/components/ui/RichHtml";

export function ArticleBody({ html }: { html: string }): React.ReactNode {
  // `.prose` already fixes the measure at 64ch and the rhythm at 16.5/1.9; the
  // article class only adds the pull-quote treatment, so a journal body and a product description
  // read as the same voice at different lengths.
  return (
    <div className="wrap">
      <RichHtml html={html} className="article-prose" />
    </div>
  );
}
