import type { PageView } from "@namilux/core/client";
import Link from "next/link";
import { PageBody } from "./PageBody";
import { t } from "@/i18n";

export function ReturnsPage({ page }: { page: PageView }): React.ReactNode {
  return (
    <>
      <PageBody page={page} />
      {/* The page explains the right; the button is where it is exercised. */}
      <div className="wrap pb-8">
        <Link href="/account/orders/" className="btn btn--secondary">
          {t("order.return")}
        </Link>
      </div>
    </>
  );
}
