"use client";
import { useEffect } from "react";
import { useCart } from "@/components/state/cart-store";

export function ClearCartOnSuccess() {
  const { clear } = useCart();
  useEffect(() => {
    clear();
  }, [clear]);
  return null;
}
