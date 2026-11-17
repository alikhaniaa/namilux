"use client";
import { faInt } from "@namilux/core/client";
import { useWishlist } from "@/components/state/wishlist-store";

export function WishlistCount(): React.ReactNode {
  const { count } = useWishlist();
  if (count === 0) return null;
  return (
    <span className="count-pill" aria-live="polite">
      {faInt(count)}
    </span>
  );
}
