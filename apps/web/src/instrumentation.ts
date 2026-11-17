export async function register(): Promise<void> {
    if (process.env.NEXT_RUNTIME === "nodejs") {
        const { startRuntimeMetrics } = await import("@namilux/config/runtime-metrics");
        startRuntimeMetrics("web");
    }
}
