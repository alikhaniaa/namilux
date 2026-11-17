import { splitLatinRuns } from "@namilux/core/client";

// A Latin run inside Persian ("SMEG KLF04BL") reorders under the bidi algorithm unless it is
// isolated; <bdi> is the isolation element that needs no direction guess.
export function Bdi({ text, className }: { text: string; className?: string }): React.ReactNode {
  const runs = splitLatinRuns(text);
  return (
    <span className={className}>
      {/* The runs partition the string in order and never reorder, so the index is a stable key. */}
      {runs.map((run, i) =>
        run.latin ? <bdi key={`${String(i)}:${run.text}`}>{run.text}</bdi> : <span key={`${String(i)}:${run.text}`}>{run.text}</span>,
      )}
    </span>
  );
}
