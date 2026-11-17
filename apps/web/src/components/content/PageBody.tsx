import type { PageView } from "@namilux/core/client";
import { RichHtml } from "@/components/ui/RichHtml";

export function PageBody({ page }: { page: PageView }): React.ReactNode {
  // the spec: exactly one <h1> per page, and it is the page's own title - never the site name.
  return (
    <article className="wrap section grid gap-5">
      <h1 className="d-1">{page.title}</h1>
      <RichHtml html={page.bodyHtml} />
    </article>
  );
}
