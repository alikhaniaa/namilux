import { getEventListeners } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@namilux/db";
import type { Drivers, WorkerEnv } from "../runtime";

const queue = vi.hoisted(() => ({ claim: vi.fn(), complete: vi.fn(), fail: vi.fn(), requeueStale: vi.fn(), heartbeat: vi.fn() }));
vi.mock("@namilux/core", () => ({ jobs: queue }));
import { sleep, startRuntime, TIMEOUTS_MS } from "../runtime";
import { evaluateHealth } from "../healthz";

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

describe("worker memory and execution bounds", () => {
  it("removes every sleep listener on timer completion and abort", async () => {
    vi.useFakeTimers();
    const signal = new AbortController();
    for (let i = 0; i < 1000; i++) {
      const pending = sleep(1, signal.signal);
      await vi.advanceTimersByTimeAsync(1);
      await pending;
    }
    expect(getEventListeners(signal.signal, "abort")).toHaveLength(0);
    const pending = sleep(1000, signal.signal);
    signal.abort();
    await pending;
    expect(getEventListeners(signal.signal, "abort")).toHaveLength(0);
  });

  it("retains a timed-out handler's claim and slot until actual settlement", async () => {
    vi.useFakeTimers();
    queue.requeueStale.mockResolvedValue(0);
    queue.claim.mockResolvedValue(null).mockResolvedValueOnce({ id: "hung", type: "media.process" });
    let finish = (): void => {};
    const work = new Promise<void>((resolve) => { finish = resolve; });
    const rt = await startRuntime({ concurrency: 1, types: ["media.process"], workerId: "test", pollMs: 100, abortGraceMs: 10 }, {
      db: {} as Db, drivers: {} as Drivers, env: {} as WorkerEnv, log, handlers: { "media.process": () => work },
    });
    await vi.advanceTimersByTimeAsync((TIMEOUTS_MS["media.process"] ?? 0) + 31_000);
    expect(rt.state.running).toBe(1);
    expect(rt.state.abandoned).toBe(1);
    expect(queue.claim).toHaveBeenCalledTimes(1);
    expect(queue.fail).not.toHaveBeenCalled();
    expect(evaluateHealth(rt.state).reason).toBe("no-free-slots");
    expect(queue.requeueStale).toHaveBeenLastCalledWith({}, 15, ["hung"]);
    finish();
    await vi.advanceTimersByTimeAsync(1);
    expect(queue.fail).toHaveBeenCalledWith({}, "hung", "timeout");
    expect(rt.state.running).toBe(0);
    expect(rt.state.activeJobs.size).toBe(0);
    await rt.stop();
  });

  it("runs only one image handler while allowing transactional work beside it", async () => {
    vi.useFakeTimers();
    queue.requeueStale.mockResolvedValue(0);
    const pending = [
      { id: "image1", type: "media.process" }, { id: "image2", type: "media.process" }, { id: "sms", type: "sms.send" },
    ];
    queue.claim.mockImplementation(async (_db, _worker, types: string[]) => {
      const index = pending.findIndex((job) => types.includes(job.type));
      return index < 0 ? null : pending.splice(index, 1)[0];
    });
    let finish = (): void => {};
    const work = new Promise<void>((resolve) => { finish = resolve; });
    const image = vi.fn(() => work);
    const sms = vi.fn(async () => {});
    const rt = await startRuntime({ concurrency: 4, types: ["media.process", "sms.send"], workerId: "test", pollMs: 100 }, {
      db: {} as Db, drivers: {} as Drivers, env: {} as WorkerEnv, log, handlers: { "media.process": image, "sms.send": sms },
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(image).toHaveBeenCalledTimes(1);
    expect(sms).toHaveBeenCalledTimes(1);
    expect(evaluateHealth(rt.state).ok).toBe(true);
    finish();
    await vi.advanceTimersByTimeAsync(1000);
    expect(image).toHaveBeenCalledTimes(2);
    await rt.stop();
  });
});
