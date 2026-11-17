"use client";
import { faInt } from "@namilux/core/client";
import type { VariantSwatch } from "@namilux/core/client";
import Link from "next/link";
import { Img } from "@/components/ui/Img";
import { t } from "@/i18n";
import { productUrl } from "@namilux/core/client";

const MAX_VISIBLE = 4;

/** The real finish when there is a swatch image, else the stored hex, else an outline. */
function Chip({ v }: { v: VariantSwatch }): React.ReactNode {
  if (v.swatch !== null) return <Img image={v.swatch} slot="thumb" alt="" className="size-full object-cover" />;
  if (v.colorHex !== null) return <span className="block size-full" style={{ backgroundColor: v.colorHex }} />;
  return null;
}

export function SwatchRow({
  variants,
  selectedId,
  mode,
  onPreview,
}: {
  variants: VariantSwatch[];
  selectedId: number;
  mode: "card" | "pdp";
  onPreview?: (id: number) => void;
}): React.ReactNode {
  // Imported model siblings are not necessarily colour variants. Never show empty circles.
  const finishes = variants.filter((v) => v.colorName.trim() !== "" && (v.swatch !== null || v.colorHex !== null));
  if (finishes.length < 2) return null;
  const visible = finishes.slice(0, MAX_VISIBLE);
  const selectedFinish = finishes.find((v) => v.productId === selectedId);
  if (selectedFinish && !visible.includes(selectedFinish)) visible[MAX_VISIBLE - 1] = selectedFinish;
  const overflow = finishes.length - visible.length;

  return (
    <div className="card-swatches flex items-center gap-[6px]">
      {visible.map((v) => {
        const selected = v.productId === selectedId;
        // DECISION: `aria-selected` belongs to a listbox/tab/grid child, so on a plain button or
        // link it is an "aria-allowed-attr" violation. A card swatch is a toggle → aria-pressed; a
        // PDP swatch is a link to the sibling product that is currently open → aria-current="page".
        // Both also need a name: the chip is an image with an empty alt, so the colour name has to
        // reach the accessibility tree through aria-label, not only through `title`.
        // EDGE CASE: a legacy variant can carry an empty `colorName`, which rendered as
        // aria-label="" - an unnamed button, which is worse than no label at all. The generic
        // «رنگ» is the honest fallback; the chip itself is decorative (alt="").
        const name = v.colorName === "" ? t("product.color") : v.colorName;
        const common = { className: "swatch block", title: name, "aria-label": name };
        // F-012: on a card the swatch previews the finish in place; on the PDP each colour is its
        // own product with its own URL and canonical, so there it must be a real link.
        return mode === "pdp" ? (
          <Link key={v.productId} href={productUrl(v.slug)} {...common} aria-current={selected ? "page" : undefined}>
            <Chip v={v} />
          </Link>
        ) : (
          <button
            key={v.productId}
            type="button"
            {...common}
            aria-pressed={selected}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onPreview?.(v.productId);
            }}
          >
            <Chip v={v} />
          </button>
        );
      })}
      {overflow > 0 ? <span className="t-xs text-ink-3">{`+${faInt(overflow)}`}</span> : null}
    </div>
  );
}
