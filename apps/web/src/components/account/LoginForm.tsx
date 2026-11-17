"use client";
import { useRouter } from "next/navigation";
import { PhoneOtp } from "@/components/auth/PhoneOtp";
import { setCartSignedIn, syncWithServer } from "@/components/state/cart-store";
import { setWishlistSignedIn, syncWishlist } from "@/components/state/wishlist-store";

export function LoginForm({ next }: { next: string }): React.ReactNode {
  const router = useRouter();
  return (
    <PhoneOtp
      purpose="login"
      onVerified={() => {
        // The session cookie is now set by the server; merge the guest cart/wishlist once.
        setCartSignedIn(true);
        setWishlistSignedIn(true);
        void syncWithServer("merge");
        void syncWishlist("merge");
        router.replace(next);
        router.refresh();
      }}
    />
  );
}
