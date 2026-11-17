import { monitorEventLoopDelay } from "node:perf_hooks";

/** Private journal metrics only: no user data and no public diagnostics endpoint. */
export function startRuntimeMetrics(service: string): void {
  if (process.env.MEMORY_METRICS !== "1") return;
  const key = Symbol.for("namilux.runtime-metrics");
  const holder = globalThis as unknown as Record<symbol, boolean | undefined>;
  if (holder[key]) return;
  holder[key] = true;
  const delay = monitorEventLoopDelay({ resolution: 20 });
  delay.enable();
  setInterval(() => {
    process.stdout.write(JSON.stringify({
      event: "runtime.metrics", service, at: new Date().toISOString(),
      uptimeSec: Math.round(process.uptime()), ...process.memoryUsage(),
      eventLoopP99Ms: Math.round(delay.percentile(99) / 1e6),
    }) + "\n");
    delay.reset();
  }, 60_000).unref();
}
