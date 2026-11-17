"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { cartStore } from "@/components/state/cart-store";
import { toast } from "@/components/state/toast-store";
import { ButtonCoin, ButtonLabel } from "@/components/ui/Button";
import { t } from "@/i18n";

const CONFIRM_MS = 1400;

export function QuickAdd({
  productId,
  available,
  onRequest,
  instalmentOff = false,
  image,
  size = "sm",
  block = true,
}: {
  productId: number;
  available: boolean;
  onRequest: boolean;
  /** Instalment site only: the product is switched off for instalments (it arrives as onRequest). */
  instalmentOff?: boolean;
  image?: string;
  size?: "sm" | "md" | "lg";
  block?: boolean;
}): React.ReactNode {
  const [added, setAdded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  const classes = ["btn", "qa", size === "sm" ? "btn--sm" : size === "lg" ? "btn--lg" : "", block ? "btn--block" : ""]
    .filter((c) => c !== "")
    .join(" ");

  // 283 products have no price: the concierge is their primary path, not a disabled buy button
  //. It is a link, because it leads to the PDP's request form.
  if (onRequest) {
    return (
      <Link href="#concierge" className={`${classes} qa--text btn--quiet`}>
        <ButtonLabel>{t(instalmentOff ? "product.instalmentOff" : "product.onRequest")}</ButtonLabel>
      </Link>
    );
  }

  if (!available) {
    return (
      <Link href="#back-in-stock" className={`${classes} qa--text btn--quiet`}>
        <ButtonLabel>{t("product.notify")}</ButtonLabel>
      </Link>
    );
  }

  const label = added ? t("product.added") : t("product.addToCart");

  return (
    <button
      type="button"
      className={`${classes} btn--primary${added ? " btn--did" : ""}`}
      aria-label={label}
      onClick={(e) => {
        // Inside the card link.
        e.preventDefault();
        e.stopPropagation();
        cartStore.add(productId, 1);
        setAdded(true);
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(() => setAdded(false), CONFIRM_MS);
        // §11: the confirmation is the button plus one toast carrying the thumbnail and the way
        // to the cart - never a drawer that hides the grid the shopper is still reading.
        toast.show({
          key: "toast.added",
          ...(image === undefined ? {} : { image }),
          action: { key: "cart.title", href: "/cart/" },
        });
      }}
    >
      <ButtonLabel>{label}</ButtonLabel>
      <ButtonCoin icon={added ? "check" : "bag"} />
    </button>
  );
}
