import { mkdir, rename, rm, stat, writeFile, readFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import type { StorageDriver } from "./types";

/** Lowercase content-hash keys only: letters, digits and `/._-`. Mirrors seed manifest STORAGE_KEY_RE. */
export const STORAGE_KEY_RE = /^[a-z0-9][a-z0-9/._-]*$/;

/** A key is safe only if it matches the grammar AND contains no `..` traversal segment. */
function assertKey(key: string): void {
  if (!STORAGE_KEY_RE.test(key) || key.split("/").some((seg) => seg === ".." || seg === "")) {
    throw new Error(`unsafe storage key: ${key}`);
  }
}

export function fsStorage(cfg: { mediaDir: string; publicPrefix?: string }): StorageDriver {
  const prefix = (cfg.publicPrefix ?? "/media").replace(/\/$/, "");
  const abs = (key: string): string => join(cfg.mediaDir, key);

  return {
    key: "fs",
    async put(storageKey: string, body: Uint8Array, _contentType: string, _opts?: { cacheControl?: string }): Promise<void> {
      assertKey(storageKey);
      const target = abs(storageKey);
      // Immutable store: a content-hash key already on disk is byte-identical, so never rewrite it.
      try {
        await stat(target);
        return;
      } catch {
        // not present → write it
      }
      await mkdir(dirname(target), { recursive: true });
      // Atomic publish: write to a unique temp sibling, then rename onto the final path.
      const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
      await writeFile(tmp, body);
      try {
        await rename(tmp, target);
      } catch (err) {
        await rm(tmp, { force: true });
        throw err;
      }
    },
    async get(storageKey: string): Promise<Uint8Array | null> {
      assertKey(storageKey);
      try {
        return await readFile(abs(storageKey));
      } catch {
        return null;
      }
    },
    async exists(storageKey: string): Promise<boolean> {
      assertKey(storageKey);
      try {
        await stat(abs(storageKey));
        return true;
      } catch {
        return false;
      }
    },
    async delete(storageKey: string): Promise<void> {
      assertKey(storageKey);
      await rm(abs(storageKey), { force: true });
    },
    publicUrl(storageKey: string): string {
      assertKey(storageKey);
      return posix.join(prefix, storageKey);
    },
  };
}
