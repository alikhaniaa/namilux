import { existsSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { extractPath, resolveExtractDir } from "../paths.js";
import {
  ALLOWED_MIME,
  type MediaIndexItem,
  REJECTED_MIME_NOTE,
  altFor,
  localFileForUrl,
  normalizeUploadUrl,
  readMediaIndex,
} from "../media-index.js";

const dir = resolveExtractDir();
const hasExtract = existsSync(extractPath(dir, "mediaCsv"));

function item(partial: Partial<MediaIndexItem>): MediaIndexItem {
  return {
    id: 1,
    sourceUrl: "https://namilux.ir/wp-content/uploads/2024/05/a.jpg",
    alt: "",
    mime: "image/jpeg",
    width: null,
    height: null,
    localFile: null,
    allowed: true,
    ...partial,
  };
}

describe("normalizeUploadUrl (pure)", () => {
  it("size suffix stripped so a rendition resolves to its original", () => {
    expect(normalizeUploadUrl("https://namilux.ir/wp-content/uploads/2025/07/x-430x430.jpg")).toBe(
      "https://namilux.ir/wp-content/uploads/2025/07/x.jpg",
    );
    expect(normalizeUploadUrl("https://namilux.ir/wp-content/uploads/2025/07/x-800x800.jpeg")).toBe(
      "https://namilux.ir/wp-content/uploads/2025/07/x.jpeg",
    );
    // A trailing "-1" is part of the name, not a size.
    expect(normalizeUploadUrl("https://namilux.ir/wp-content/uploads/2024/04/airwarap-ms-4-600x600-1.jpg")).toBe(
      "https://namilux.ir/wp-content/uploads/2024/04/airwarap-ms-4-600x600-1.jpg",
    );
  });

  it("relative upload url absolutised and query stripped", () => {
    expect(normalizeUploadUrl("/wp-content/uploads/2024/05/a.jpg?ver=2#frag")).toBe(
      "https://namilux.ir/wp-content/uploads/2024/05/a.jpg",
    );
    expect(normalizeUploadUrl("//namilux.ir/wp-content/uploads/2024/05/a.jpg")).toBe(
      "https://namilux.ir/wp-content/uploads/2024/05/a.jpg",
    );
    expect(normalizeUploadUrl("")).toBe("");
  });
});

describe("allow-list and alt", () => {
  it("svg not allowed and every rejected mime carries a note", () => {
    expect(ALLOWED_MIME).not.toContain("image/svg+xml");
    expect(ALLOWED_MIME).not.toContain("image/gif");
    expect(ALLOWED_MIME).not.toContain("video/mp4");
    expect(REJECTED_MIME_NOTE["image/svg+xml"]).toBeTruthy();
    expect(REJECTED_MIME_NOTE["image/gif"]).toBeTruthy();
  });

  it("alt fallback never empty", () => {
    expect(altFor(item({ alt: "کتری برقی" }), "fallback")).toBe("کتری برقی");
    expect(altFor(item({ alt: "   " }), "fallback")).toBe("fallback");
    expect(altFor(undefined, "fallback")).toBe("fallback");
  });
});

describe("localFileForUrl", () => {
  it("missing files dir → null without throwing", () => {
    expect(() => localFileForUrl(path.resolve("/no-such-extract"), "/wp-content/uploads/2024/05/a.jpg")).not.toThrow();
    expect(localFileForUrl(path.resolve("/no-such-extract"), "/wp-content/uploads/2024/05/a.jpg")).toBeNull();
  });

  it.skipIf(!hasExtract)("windows-unsafe chars mapped and traversal refused", () => {
    // files/ is gitignored and empty here, so every lookup is null - the point is that the mapping
    // runs and never escapes the tree or throws.
    expect(localFileForUrl(dir, '/wp-content/uploads/2024/05/a<b>c:d"e|f?g*h.jpg')).toBeNull();
    expect(localFileForUrl(dir, "/wp-content/uploads/../../../../etc/passwd")).toBeNull();
    expect(localFileForUrl(dir, "")).toBeNull();
  });
});

describe.skipIf(!hasExtract)("real media.csv", () => {
  let index: Awaited<ReturnType<typeof readMediaIndex>>;

  beforeAll(async () => {
    index = await readMediaIndex(dir);
  });

  it("indexes all 3,657 rows by id and by normalised url", () => {
    expect(index.stats.rows).toBe(3657);
    expect(index.byId.size).toBe(3657);
    expect(index.byUrl.size).toBeGreaterThan(3600);
  });

  it("counts alt coverage and the allow-list", () => {
    expect(index.stats.withAlt).toBe(628);
    expect(index.stats.allowed).toBe(3422);
    for (const it of index.byId.values()) {
      if (it.allowed) expect(ALLOWED_MIME).toContain(it.mime);
      else expect(ALLOWED_MIME).not.toContain(it.mime);
    }
  });

  // The files dir is git-ignored: absent on a clean checkout, populated on a machine that ran the
  // media fetch. The assertion follows the machine instead of assuming one of the two.
  it("files dir absent/empty → localPresent 0 and no localFile anywhere (else every localFile is real)", () => {
    const present = index.stats.localPresent;
    if (present === 0) {
      expect([...index.byId.values()].every((i) => i.localFile === null)).toBe(true);
    } else {
      expect([...index.byId.values()].filter((i) => i.localFile !== null)).toHaveLength(present);
    }
  });

  it("an id that no row carries is simply undefined", () => {
    expect(index.byId.get(-1)).toBeUndefined();
    expect(altFor(index.byId.get(-1), "post title")).toBe("post title");
  });

  it("svg rows are present but never allowed", () => {
    const svgs = [...index.byId.values()].filter((i) => i.mime === "image/svg+xml");
    expect(svgs.length).toBe(124);
    expect(svgs.every((s) => !s.allowed && s.localFile === null)).toBe(true);
  });
});
