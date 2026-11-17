"use client";
import { faInt } from "@namilux/core/client";
import { useEffect, useRef, useState } from "react";
import { useCart } from "@/components/state/cart-store";

export function CartBadge(): React.ReactNode {
  const { count } = useCart();
  const previous = useRef(count);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    // Only an increase is worth celebrating; removing a line should not bounce the badge.
    if (count > previous.current) {
      setPulse(true);
      const timer = setTimeout(() => setPulse(false), 260);
      previous.current = count;
      return () => clearTimeout(timer);
    }
    previous.current = count;
    return undefined;
  }, [count]);

  if (count === 0) return null;
  return (
    <span className={`count-pill${pulse ? " count-pill--pulse" : ""}`} aria-live="polite">
      {faInt(count)}
    </span>
  );
}
