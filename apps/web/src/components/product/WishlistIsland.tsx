"use client";
import { ROUTES } from "@namilux/core/client";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useWishlist } from "@/components/state/wishlist-store";

const MAX_IDS = 60;

function wishlistHref(ids: number[]): string {
  return ids.length === 0 ? ROUTES.wishlist : `${ROUTES.wishlist}?ids=${ids.slice(0, MAX_IDS).join(",")}`;
}

export function WishlistIsland({ shown }: { shown: number[] }): React.ReactNode {
  const router = useRouter();
  const { ids } = useWishlist();
  const first = useRef(true);

  useEffect(() => {
    const same = ids.length === shown.length && ids.every((id, i) => id === shown[i]);
    if (same) return;
    // The store hydrates from localStorage after the first paint: an empty first reading must not
    // wipe a URL that already carries ids; a non-empty one adopts them at once.
    if (first.current) {
      first.current = false;
      if (ids.length === 0) return;
    }
    router.replace(wishlistHref(ids));
  }, [ids, shown, router]);

  return null;
}
