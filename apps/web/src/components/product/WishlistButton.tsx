"use client";
import { useWishlist } from "@/components/state/wishlist-store";
import { ButtonCoin, ButtonLabel } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { t } from "@/i18n";

export function WishlistButton({
  productId,
  variant,
}: {
  productId: number;
  variant: "chip" | "button";
}): React.ReactNode {
  const { has, toggle } = useWishlist();
  const on = has(productId);
  const label = on ? t("product.wishlist.remove") : t("product.wishlist.add");

  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={(e) => {
        // The card is one big link; the heart must not navigate with it.
        e.preventDefault();
        e.stopPropagation();
        toggle(productId);
      }}
      className={
        variant === "chip"
          ? // On the plate: plate-scoped ink, because the plate is light in both themes.
            "chip-on-plate absolute end-2 top-2 z-10 grid size-[36px] place-items-center"
          : "btn btn--quiet"
      }
    >
      {variant === "chip" ? (
        <Icon name={on ? "heart-filled" : "heart"} size={20} />
      ) : (
        <>
          <ButtonLabel>{label}</ButtonLabel>
          <ButtonCoin icon={on ? "heart-filled" : "heart"} />
        </>
      )}
    </button>
  );
}
