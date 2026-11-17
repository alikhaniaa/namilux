"use client";
import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { toast } from "@/components/state/toast-store";
import { t } from "@/i18n";

/**
 * Copies the shop's address - the one thing a visitor actually wants to take away from an About
 * page, because it is going to be pasted into a ride-hailing app.
 *
 * The address itself stays on the page as selectable text (the sibling <p>), so a browser that
 * refuses clipboard access - an insecure origin, a permissions policy, a private window - loses a
 * convenience and nothing else. That is why the failure is swallowed instead of toasted: there is
 * nothing for the visitor to do about it, and the text is right there.
 */
export function CopyAddress({ address }: { address: string }): React.ReactNode {
  const [copied, setCopied] = useState(false);
  if (address.trim() === "") return null;

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      toast.show({ key: "page.about.address.copied" });
    } catch {
      /* clipboard blocked: the address is still on screen to select */
    }
  };

  return (
    <button type="button" className="btn btn--quiet btn--sm justify-self-start" onClick={() => void copy()}>
      <Icon name={copied ? "check" : "share"} size={20} />
      {t(copied ? "page.about.address.copied" : "page.about.address.copy")}
    </button>
  );
}
