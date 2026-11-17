import { faInt } from "@namilux/core/client";
import type { Dims } from "@namilux/core/client";
import { t } from "@/i18n";

const VIEW = 220;
const PAD = 34;

export function DimensionDrawing({ dims }: { dims: Dims }): React.ReactNode {
  const { widthMm, heightMm, lengthMm } = dims;
  if (widthMm <= 0 || heightMm <= 0) return null;

  // The box is drawn to the real proportions, scaled to fit - a figure that lies about the shape
  // is worse than no figure. Depth is the small parallelogram offset, not a third labelled axis.
  const span = VIEW - PAD * 2;
  const scale = span / Math.max(widthMm, heightMm);
  const w = widthMm * scale;
  const h = heightMm * scale;
  const d = Math.min(lengthMm * scale, span * 0.28);
  const x = (VIEW - w - d) / 2;
  const y = (VIEW - h - d) / 2 + d;

  const cm = (mm: number): string => `${faInt(Math.round(mm / 10))} ${t("product.dims.cm")}`;

  return (
    <figure className="grid justify-items-center gap-2">
      <svg viewBox={`0 0 ${String(VIEW)} ${String(VIEW)}`} width="100%" className="max-w-[220px] text-ink" role="img" aria-label={t("product.dims")}>
        <g fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round">
          <rect x={x} y={y} width={w} height={h} />
          <path d={`M${String(x)} ${String(y)} l${String(d)} ${String(-d)} h${String(w)} l${String(-d)} ${String(d)}`} />
          <path d={`M${String(x + w)} ${String(y)} l${String(d)} ${String(-d)} v${String(h)} l${String(-d)} ${String(d)}`} />
        </g>
      </svg>
      <figcaption className="t-xs text-ink-3">
        {[cm(widthMm), cm(heightMm), lengthMm > 0 ? cm(lengthMm) : null].filter(Boolean).join(" × ")}
      </figcaption>
    </figure>
  );
}
