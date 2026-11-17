import { describe, expect, it } from "vitest";

import type { Renditions } from "../../types";
import {
  MEDIA_PUBLIC_PREFIX,
  type MediaRowLike,
  imgSrc,
  imgSrcSet,
  largestRendition,
  mediaUrl,
  ogSourceKey,
  toImageRef,
  toVideoRef,
  preferOfficialImages,
} from "../media";

it("uses reviewed manufacturer galleries without losing legacy admin media", () => {
  const legacy = refOf();
  const official = { ...legacy, id: "reviewed", renditions: { ...FULL, master: "catalog/official/ecf03/abc.jpg" } };
  const all = [official, legacy];
  expect(preferOfficialImages(all)).toEqual([official]);
  expect(all).toHaveLength(2);
  expect(preferOfficialImages([legacy])).toEqual([legacy]);
  expect(preferOfficialImages([])).toEqual([]);
});

const BASE = "p/1044/1/a8f3c1";
const LQIP = "data:image/webp;base64,UklGRhYAAABXRUJQVlA4TAoAAAAvAAAAAAfQ";

/** the spec `renditions_json`; parts are optional so a fixture can drop a whole format. */
const rend = (i: {
  avif?: Record<string, string>;
  webp?: Record<string, string>;
  master?: string;
}): Renditions => ({ avif: i.avif ?? {}, webp: i.webp ?? {}, master: i.master ?? "" });

/** The five product-tile / gallery widths of v2 §5.4. */
const widthMap = (ext: "avif" | "webp"): Record<string, string> =>
  Object.fromEntries([320, 480, 640, 960, 1280].map((w) => [String(w), `${BASE}-${w}.${ext}`]));

const FULL: Renditions = rend({
  avif: widthMap("avif"),
  webp: widthMap("webp"),
  master: `${BASE}.jpg`,
});

const imageRow = (over: Partial<MediaRowLike> = {}): MediaRowLike => ({
  id: "01K4ZQ8N7C3M0V2R6T9YB1XJHP",
  kind: "image",
  storageKey: `${BASE}.jpg`,
  mime: "image/jpeg",
  width: 1600,
  height: 2000,
  durationMs: null,
  alt: "کتری برقی اسمگ",
  lqip: LQIP,
  renditionsJson: FULL,
  normalizeJson: { subjectH: 0.66, widthBound: false, quarantined: false },
  ...over,
});

const refOf = (over: Partial<MediaRowLike> = {}): NonNullable<ReturnType<typeof toImageRef>> => {
  const ref = toImageRef(imageRow(over));
  if (ref === null) throw new Error("fixture must map to an ImageRef");
  return ref;
};

describe("toImageRef", () => {
  it("quarantined returns null", () => {
    const row = imageRow({ normalizeJson: { quarantined: true, reason: "full-bleed frame (bbox 100%)" } });
    expect(toImageRef(row)).toBeNull();
    // admin QA view is the only caller allowed to see it
    expect(toImageRef(row, { allowQuarantined: true })?.key).toBe(`${BASE}.jpg`);
    expect(toImageRef(imageRow({ normalizeJson: { quarantined: false } }))).not.toBeNull();
    expect(toImageRef(imageRow({ normalizeJson: null }))).not.toBeNull();
  });

  it("alt fallback", () => {
    expect(refOf({ alt: "  کتری برقی درجه‌دار  " }).alt).toBe("کتری برقی درجه‌دار");
    expect(toImageRef(imageRow({ alt: "   " }), { altFallback: "کتری برقی اسمگ KLF04" })?.alt).toBe(
      "کتری برقی اسمگ KLF04",
    );
    expect(toImageRef(imageRow({ alt: "" }))?.alt).toBe("");
    // a non-empty row alt always wins over the fallback
    expect(toImageRef(imageRow({ alt: "توستر" }), { altFallback: "چیز دیگر" })?.alt).toBe("توستر");
  });

  it("kind mismatch returns null", () => {
    expect(toImageRef(imageRow({ kind: "video" }))).toBeNull();
    expect(toImageRef(imageRow({ kind: "file" }))).toBeNull();
    expect(toVideoRef(imageRow())).toBeNull();
    expect(toVideoRef(imageRow({ kind: "file" }))).toBeNull();
  });

  it("null dimensions become 0", () => {
    const ref = refOf({ width: null, height: null });
    expect(ref.width).toBe(0);
    expect(ref.height).toBe(0);
    expect(Number.isNaN(ref.width)).toBe(false);
    expect(Number.isNaN(ref.height)).toBe(false);
    // defensive: garbage numbers from jsonb collapse to 0 as well, never NaN
    expect(refOf({ width: Number.NaN, height: -12 }).width).toBe(0);
    expect(refOf({ width: Number.NaN, height: -12 }).height).toBe(0);
    expect(refOf({ width: 1599.6 }).width).toBe(1599);
  });

  it("returns null without renditions and passes lqip through verbatim", () => {
    expect(toImageRef(imageRow({ renditionsJson: null }))).toBeNull();
    expect(refOf().lqip).toBe(LQIP);
    expect(refOf({ lqip: null }).lqip).toBeUndefined();
    // DECISION guard: only an inline image data URI survives (the single `data:` value on a card)
    expect(refOf({ lqip: "javascript:alert(1)" }).lqip).toBeUndefined();
    expect(refOf({ lqip: "data:text/html;base64,PHNjcmlwdD4=" }).lqip).toBeUndefined();
    expect(refOf({ lqip: "https://cdn.example.com/p.webp" }).lqip).toBeUndefined();
  });
});

describe("toVideoRef", () => {
  it("maps a video row to a first-party src", () => {
    const row = imageRow({
      kind: "video",
      storageKey: "v/12/dyson-hs08.mp4",
      mime: "video/mp4",
      durationMs: 18_400,
    });
    expect(toVideoRef(row)).toEqual({
      id: row.id,
      src: "/media/v/12/dyson-hs08.mp4",
      mime: "video/mp4",
      durationMs: 18_400,
      poster: null,
    });
    const poster = refOf();
    expect(toVideoRef(row, poster)?.poster).toBe(poster);
    expect(toVideoRef({ ...row, durationMs: null })?.durationMs).toBeNull();
  });
});

describe("imgSrc", () => {
  it("imgSrc picks smallest ≥ width", () => {
    const ref = refOf();
    expect(imgSrc(ref, 320)).toBe(`/media/${BASE}-320.webp`);
    expect(imgSrc(ref, 321)).toBe(`/media/${BASE}-480.webp`);
    expect(imgSrc(ref, 480)).toBe(`/media/${BASE}-480.webp`);
    expect(imgSrc(ref, 700)).toBe(`/media/${BASE}-960.webp`);
    expect(imgSrc(ref, 960, "avif")).toBe(`/media/${BASE}-960.avif`);
    // default format is webp (contract)
    expect(imgSrc(ref, 640)).toBe(imgSrc(ref, 640, "webp"));
    // degenerate requests take the smallest, never a data: URL
    expect(imgSrc(ref, 0)).toBe(`/media/${BASE}-320.webp`);
    expect(imgSrc(ref, Number.NaN)).toBe(`/media/${BASE}-320.webp`);
  });

  it("imgSrc falls back to largest", () => {
    const ref = refOf();
    expect(imgSrc(ref, 2400)).toBe(`/media/${BASE}-1280.webp`);
    expect(imgSrc(ref, Number.POSITIVE_INFINITY, "avif")).toBe(`/media/${BASE}-1280.avif`);
  });

  it("format fallback avif↔webp then master", () => {
    const avifOnly = refOf({ renditionsJson: rend({ avif: widthMap("avif"), master: `${BASE}.jpg` }) });
    expect(imgSrc(avifOnly, 480, "webp")).toBe(`/media/${BASE}-480.avif`);
    expect(imgSrc(avifOnly, 480, "avif")).toBe(`/media/${BASE}-480.avif`);

    const webpOnly = refOf({ renditionsJson: rend({ webp: widthMap("webp"), master: `${BASE}.jpg` }) });
    expect(imgSrc(webpOnly, 480, "avif")).toBe(`/media/${BASE}-480.webp`);

    const masterOnly = refOf({ renditionsJson: rend({ master: `${BASE}.jpg` }) });
    expect(imgSrc(masterOnly, 480, "webp")).toBe(`/media/${BASE}.jpg`);
    expect(imgSrc(masterOnly, 480, "avif")).toBe(`/media/${BASE}.jpg`);

    // not even a master key → the media row's own storage key, still first-party
    const bare = refOf({ storageKey: "p/9/orig.jpg", renditionsJson: rend({}) });
    expect(imgSrc(bare, 480)).toBe("/media/p/9/orig.jpg");
  });
});

describe("imgSrcSet and largestRendition", () => {
  it("srcset ascending order", () => {
    // "0480" is not an integer-index key, so the runtime hands it back last: the ascending order
    // below is produced by the module, not by the object literal.
    const ref = refOf({
      renditionsJson: rend({
        webp: { "1280": `${BASE}-1280.webp`, "320": `${BASE}-320.webp`, "0480": `${BASE}-480.webp` },
        master: `${BASE}.jpg`,
      }),
    });
    expect(imgSrcSet(ref, "webp")).toBe(
      `/media/${BASE}-320.webp 320w, /media/${BASE}-480.webp 480w, /media/${BASE}-1280.webp 1280w`,
    );
    expect(imgSrcSet(refOf(), "avif")).toBe(
      [320, 480, 640, 960, 1280].map((w) => `/media/${BASE}-${w}.avif ${w}w`).join(", "),
    );
  });

  it("srcset never crosses formats and largestRendition reports null", () => {
    const avifOnly = refOf({ renditionsJson: rend({ avif: widthMap("avif"), master: `${BASE}.jpg` }) });
    // DECISION: a <source type="image/webp"> must not be fed avif bytes - empty srcset instead
    expect(imgSrcSet(avifOnly, "webp")).toBe("");
    expect(largestRendition(avifOnly, "webp")).toBeNull();
    expect(largestRendition(avifOnly, "avif")).toEqual({
      width: 1280,
      url: `/media/${BASE}-1280.avif`,
    });
    expect(largestRendition(refOf(), "webp")).toEqual({ width: 1280, url: `/media/${BASE}-1280.webp` });
    expect(largestRendition(refOf({ renditionsJson: rend({}) }), "avif")).toBeNull();
  });

  it("ignores non-numeric width keys", () => {
    const noisy = refOf({
      renditionsJson: rend({
        webp: {
          "320": `${BASE}-320.webp`,
          master: `${BASE}.jpg`,
          "": `${BASE}-empty.webp`,
          "-480": `${BASE}-neg.webp`,
          "0": `${BASE}-zero.webp`,
          "960px": `${BASE}-960.webp`,
          "1280": `${BASE}-1280.webp`,
        },
        master: `${BASE}.jpg`,
      }),
    });
    expect(imgSrcSet(noisy, "webp")).toBe(
      `/media/${BASE}-320.webp 320w, /media/${BASE}-1280.webp 1280w`,
    );
    expect(imgSrc(noisy, 400)).toBe(`/media/${BASE}-1280.webp`);
    expect(largestRendition(noisy, "webp")).toEqual({ width: 1280, url: `/media/${BASE}-1280.webp` });

    // a malformed jsonb payload (wrong value types, missing maps) is tolerated, never thrown on
    const malformed = refOf({
      renditionsJson: {
        avif: { "320": 320, "480": null },
        master: 7,
      } as unknown as Renditions,
      storageKey: "p/9/orig.jpg",
    });
    expect(imgSrcSet(malformed, "avif")).toBe("");
    expect(largestRendition(malformed, "avif")).toBeNull();
    expect(imgSrc(malformed, 480)).toBe("/media/p/9/orig.jpg");
    expect(ogSourceKey(malformed)).toBe("p/9/orig.jpg");
  });
});

describe("ogSourceKey and the first-party contract", () => {
  it("returns renditions.master, else the row storage key", () => {
    expect(ogSourceKey(refOf())).toBe(`${BASE}.jpg`);
    expect(ogSourceKey(refOf({ storageKey: "p/9/orig.jpg", renditionsJson: rend({ master: "   " }) }))).toBe(
      "p/9/orig.jpg",
    );
  });

  it("every emitted URL is first-party /media/", () => {
    expect(MEDIA_PUBLIC_PREFIX).toBe("/media/");
    expect(mediaUrl(`${BASE}-320.webp`)).toBe(`/media/${BASE}-320.webp`);
    const ref = refOf();
    const urls = [
      imgSrc(ref, 480),
      imgSrc(ref, 480, "avif"),
      largestRendition(ref, "webp")?.url ?? "",
      ...imgSrcSet(ref, "webp").split(", ").map((part) => part.split(" ")[0] ?? ""),
      toVideoRef(imageRow({ kind: "video", storageKey: "v/1/a.mp4" }))?.src ?? "",
    ];
    for (const url of urls) {
      expect(url.startsWith(MEDIA_PUBLIC_PREFIX)).toBe(true);
      expect(url.startsWith("data:")).toBe(false);
      expect(/^[a-z][a-z0-9+.-]*:/i.test(url)).toBe(false);
    }
    // a storage key that tries to escape the origin is rejected by url/routes
    expect(() => imgSrc(refOf({ renditionsJson: rend({ master: "https://cdn.example.com/x.jpg" }) }), 480)).toThrow(
      RangeError,
    );
    expect(() => imgSrc(refOf({ renditionsJson: rend({ master: "../../etc/passwd" }) }), 480)).toThrow(RangeError);
  });
});
