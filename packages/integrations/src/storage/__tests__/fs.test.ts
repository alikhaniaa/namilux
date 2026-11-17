import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fsStorage } from "../fs";

describe("fs storage", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "nl-fs-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("rejects path-traversal and non-conforming keys", async () => {
    const s = fsStorage({ mediaDir: dir });
    await expect(s.put("../secret", new Uint8Array([1]), "image/jpeg")).rejects.toThrow(/unsafe storage key/);
    await expect(s.put("a/../../b", new Uint8Array([1]), "image/jpeg")).rejects.toThrow(/unsafe storage key/);
    await expect(s.get("/etc/passwd")).rejects.toThrow(/unsafe storage key/);
  });

  it("writes atomically and reads back the bytes", async () => {
    const s = fsStorage({ mediaDir: dir });
    const key = "p/1/1/abc.jpg";
    await s.put(key, new Uint8Array([1, 2, 3]), "image/jpeg");
    expect(await s.exists(key)).toBe(true);
    expect([...(await s.get(key))!]).toEqual([1, 2, 3]);
    expect(await readFile(join(dir, key))).toBeDefined();
  });

  it("never overwrites an existing content-hash key", async () => {
    const s = fsStorage({ mediaDir: dir });
    const key = "c/hash.jpg";
    await s.put(key, new Uint8Array([1, 1, 1]), "image/jpeg");
    await s.put(key, new Uint8Array([9, 9, 9, 9]), "image/jpeg"); // ignored - immutable
    expect([...(await s.get(key))!]).toEqual([1, 1, 1]);
  });

  it("publicUrl uses the /media prefix", () => {
    const s = fsStorage({ mediaDir: dir });
    expect(s.publicUrl("p/1/1/abc.jpg")).toBe("/media/p/1/1/abc.jpg");
  });

  it("get returns null and delete is a no-op for a missing key", async () => {
    const s = fsStorage({ mediaDir: dir });
    expect(await s.get("c/missing.jpg")).toBeNull();
    await expect(s.delete("c/missing.jpg")).resolves.toBeUndefined();
  });
});
