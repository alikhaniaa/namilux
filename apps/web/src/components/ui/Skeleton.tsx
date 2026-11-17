const ASPECT = { "4/5": "aspect-[4/5]", "16/9": "aspect-[16/9]", "1/1": "aspect-square", line: "h-[1lh] w-full" } as const;

export function Skeleton({
  className,
  aspect = "line",
}: {
  className?: string;
  aspect?: "4/5" | "16/9" | "1/1" | "line";
}): React.ReactNode {
  // The shimmer is defined in components.css and disables itself under reduced motion; the ground
  // is `--plate` exactly so a skeleton and the tile it stands in for occupy the same colour region.
  return <div className={["skeleton", ASPECT[aspect], className ?? ""].filter((c) => c !== "").join(" ")} aria-hidden="true" />;
}
