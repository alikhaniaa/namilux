"use client";
import { Button } from "@/components/kit";
import { fa } from "@/i18n/fa";

export function PrintButton() {
  return (
    <Button variant="outline" onClick={() => window.print()}>
      {fa["orders.invoice"]}
    </Button>
  );
}
