import { redirect } from "next/navigation";

/** Exchange-rate pricing moved into the pricing section. */
export default function FxRedirect() {
  redirect("/products/prices/fx");
}
