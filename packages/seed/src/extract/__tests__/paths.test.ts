import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXTRACT_FILES,
  EXTRACT_META,
  OPTIONAL_FILES,
  PRODUCT_DIR_RE,
  PRODUCT_IMAGE_RE,
  REQUIRED_FILES,
  extractPath,
  missingExtractFiles,
  productDirs,
  resolveExtractDir,
  resolveMediaDir,
} from "../paths.js";

const dir = resolveExtractDir();
const hasExtract = existsSync(extractPath(dir, "productsDir"));

describe("resolvers", () => {
  it("override wins over env", () => {
    const env = { SEED_EXTRACT_DIR: "/from-env" } as unknown as NodeJS.ProcessEnv;
    expect(resolveExtractDir("./from-override", env)).toBe(path.resolve("./from-override"));
    expect(resolveExtractDir(null, env)).toBe(path.resolve("/from-env"));
    expect(resolveExtractDir(null, {}).endsWith(path.join("data", "extract"))).toBe(true);

    const mediaEnv = { MEDIA_DIR: "./m" } as unknown as NodeJS.ProcessEnv;
    expect(resolveMediaDir("./o", mediaEnv)).toBe(path.resolve("./o"));
    expect(resolveMediaDir(null, mediaEnv)).toBe(path.resolve("./m"));
    expect(resolveMediaDir(null, {}).endsWith(".media")).toBe(true);
  });

  it("product dir regex accepts both layouts", () => {
    expect(PRODUCT_DIR_RE.exec("1044")?.[1]).toBe("1044");
    expect(PRODUCT_DIR_RE.exec("1044-%d8%a7%db%8c%d8%b1%d9%be")?.[1]).toBe("1044");
    expect(PRODUCT_DIR_RE.exec("images")).toBeNull();
    expect(PRODUCT_IMAGE_RE.exec("01-airwrap.jpg")?.[1]).toBe("01");
    expect(PRODUCT_IMAGE_RE.exec("airwrap.jpg")).toBeNull();
  });

  it("missing files listed when SEED_EXTRACT_DIR points nowhere", () => {
    const missing = missingExtractFiles(path.resolve("/definitely-not-here-namilux"));
    expect(missing).toHaveLength(REQUIRED_FILES.length);
    expect(missing).toContain(EXTRACT_FILES.inventoryCsv);
    expect(OPTIONAL_FILES).not.toContain("inventoryCsv");
  });

  it("EXTRACT_META records the crawl instant used for seo_snapshots", () => {
    expect(EXTRACT_META.origin).toBe("https://namilux.ir");
    expect(Number.isNaN(Date.parse(EXTRACT_META.extractedAt))).toBe(false);
  });
});

describe.skipIf(!hasExtract)("real extract", () => {
  it("lists the 541 product folders sorted by id ascending", () => {
    const dirs = productDirs(dir);
    expect(dirs).toHaveLength(541);
    const ids = dirs.map((d) => d.id);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("reports no missing required file", () => {
    expect(missingExtractFiles(dir)).toEqual([]);
  });
});
