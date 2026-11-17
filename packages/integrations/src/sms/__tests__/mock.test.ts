import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mockSmsDriver, readLastMockSms } from "../mock";

describe("mock sms", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "nl-sms-"));
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it("appends to outbox", async () => {
    const outbox = join(dir, "nested", "outbox.jsonl");
    const d = mockSmsDriver({ outboxPath: outbox });
    const r1 = await d.send("09121234567", "کد ۱۲۳۴۵۶");
    const r2 = await d.send("09121234567", "دومی");
    expect(r1.ok && r2.ok).toBe(true);
    const lines = (await readFile(outbox, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ to: "09121234567", text: "کد ۱۲۳۴۵۶" });
    if (r1.ok) expect(r1.costToman).toBe(0);
  });

  it("readLastMockSms finds by phone", async () => {
    const outbox = join(dir, "outbox2.jsonl");
    const d = mockSmsDriver({ outboxPath: outbox });
    await d.send("09121111111", "اولی");
    await d.send("09122222222", "دیگری");
    await d.send("09121111111", "آخری");
    expect((await readLastMockSms(outbox, "09121111111"))?.text).toBe("آخری");
    expect((await readLastMockSms(outbox, "09123333333"))).toBeNull();
    expect(await readLastMockSms(join(dir, "missing.jsonl"), "09121111111")).toBeNull();
  });
});
