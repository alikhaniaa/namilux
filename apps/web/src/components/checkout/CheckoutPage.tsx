"use client";
import { useState } from "react";
import type { Address, SealEmbed, ShippingMethod } from "@namilux/core/client";
import { useCart } from "@/components/state/cart-store";
import { t } from "@/i18n";
import { CheckoutStepper } from "./CheckoutStepper";
import { StepDelivery } from "./StepDelivery";
import { StepIdentity } from "./StepIdentity";

type Seal = SealEmbed | null;
type User = { id: string; firstName: string | null; lastName: string | null; phone: string } | null;

export function CheckoutPage({ user: initialUser, addresses, methods, flags, snappEnabled, seals, pointsAvailable }: { user: User; addresses: Address[]; methods: ShippingMethod[]; flags: { checkoutEnabled: boolean }; snappEnabled: boolean; seals: { enamad: Seal; samandehi: Seal }; pointsAvailable: number }): React.ReactNode {
  const [user, setUser] = useState<User>(initialUser);
  const { lines } = useCart();
  void methods; // shipping options come from the signed quote, not the raw method list

  // Design audit 2 Sep 2026: checkout is a focused room - the identity step is one measured column
  // (components.css `.checkout--identity`), the delivery step a form beside a sticky summary.
  if (!flags.checkoutEnabled) return <p className="panel ps-4 pe-4 pt-4 pb-4 checkout--identity">{t("checkout.disabled")}</p>;
  if (lines.length === 0) return <p className="panel ps-4 pe-4 pt-4 pb-4 checkout--identity">{t("cart.empty.title")}</p>;
  if (user === null) {
    return (
      <div className="checkout--identity">
        <CheckoutStepper current={1} />
        <StepIdentity onDone={(u) => setUser(u)} />
      </div>
    );
  }

  return (
    <div>
      <CheckoutStepper current={2} />
      <StepDelivery initialAddresses={addresses} snappEnabled={snappEnabled} seals={seals} pointsAvailable={pointsAvailable} />
    </div>
  );
}
