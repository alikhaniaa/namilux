import { faInt } from "@namilux/core/client";

type Segments = { total: number; current: number };
type Bar = { value: number; label: string };

function isSegments(p: Segments | Bar): p is Segments {
  return "total" in p;
}

export function Progress(props: Segments | Bar): React.ReactNode {
  if (isSegments(props)) {
    const { total, current } = props;
    if (total <= 1) return null;
    // The gallery indicator: one 2 px segment per image, the current one in ink. It is decorative - 
    // the gallery itself announces "image n of m", so this must not be read twice.
    return (
      <div className="flex gap-1" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={`seg-${faInt(i + 1)}`}
            className={`h-[2px] flex-1 ${i === current ? "bg-ink" : "bg-line-2"}`}
          />
        ))}
      </div>
    );
  }

  const pct = Math.max(0, Math.min(1, props.value));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct * 100)}
      aria-label={props.label}
      className="h-[2px] w-full bg-line-2"
    >
      <span className="block h-full bg-ink" style={{ inlineSize: `${String(Math.round(pct * 100))}%` }} />
    </div>
  );
}
