"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { captureUtm, pageview } from "@/lib/analytics-client";

export function PageviewBeacon(): React.ReactNode {
  const pathname = usePathname();
  const search = useSearchParams();
  const key = `${pathname}?${search.toString()}`;
  useEffect(() => {
    captureUtm();
  }, []);
  useEffect(() => {
    pageview();
  }, [key]);
  return null;
}
