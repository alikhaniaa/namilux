"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs } from "@/components/kit-client";
import { fa } from "@/i18n/fa";

export type InboxTab = "concierge" | "questions" | "contact" | "backInStock" | "reviews" | "returns";

export function InboxTabs({ current, counts }: { current: InboxTab; counts: Partial<Record<InboxTab, number>> }) {
  const router = useRouter();
  const sp = useSearchParams();
  const tabs: { key: InboxTab; label: string }[] = [
    { key: "concierge", label: fa["inbox.tab.concierge"] },
    { key: "questions", label: fa["inbox.tab.questions"] },
    { key: "contact", label: fa["inbox.tab.contact"] },
    { key: "backInStock", label: fa["inbox.tab.backInStock"] },
    { key: "reviews", label: fa["inbox.tab.reviews"] },
    { key: "returns", label: fa["inbox.tab.returns"] },
  ];
  return (
    <Tabs
      tabs={tabs.map((t) => ({ ...t, ...(counts[t.key] === undefined ? {} : { count: counts[t.key] }) }))}
      current={current}
      onChange={(key) => {
        const next = new URLSearchParams(sp.toString());
        next.set("tab", key);
        next.delete("page");
        router.push(`/inbox?${next.toString()}`);
      }}
    />
  );
}
