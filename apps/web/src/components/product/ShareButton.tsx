"use client";
import { share } from "@/components/pwa/standalone";
import { toast } from "@/components/state/toast-store";
import { ButtonCoin, ButtonLabel } from "@/components/ui/Button";
import { t } from "@/i18n";

export function ShareButton({ title, url }: { title: string; url: string }): React.ReactNode {
  return (
    <>
      <button
        type="button"
        className="btn btn--quiet"
        onClick={() => {
          void share({ title, url }).then((how) => {
            // A cancelled native share reports "shared" and says nothing - only the clipboard
            // fallback needs a confirmation, because nothing visible happened.
            if (how === "copied") toast.show({ key: "product.share.copied" });
          });
        }}
      >
        <ButtonLabel>{t("product.share")}</ButtonLabel>
        <ButtonCoin icon="share" />
      </button>
      <a
        href={`https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="btn btn--quiet"
      >
        <ButtonLabel>{t("product.share.whatsapp")}</ButtonLabel>
        <ButtonCoin icon="whatsapp" />
      </a>
    </>
  );
}
