"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { fa } from "@/i18n/fa";
import { api } from "@/lib/api-client";

/** `menu`: drawn as an item of the user menu rather than as a button of its own. */
export function Logout({ menu = false }: { menu?: boolean }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className={menu ? "is-danger" : "ui-btn ui-btn--ghost ui-btn--sm"}
      onClick={() => {
        void api("/api/auth/logout", { method: "POST" }).finally(() => router.push("/login"));
      }}
    >
      <LogOut size={16} aria-hidden="true" />
      {fa["auth.logout"]}
    </button>
  );
}
