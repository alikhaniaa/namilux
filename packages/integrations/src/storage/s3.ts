import { createHash, createHmac } from "node:crypto";
import { STORAGE_KEY_RE } from "./fs";
import type { StorageDriver } from "./types";

export type SigV4Config = { accessKey: string; secretKey: string; region?: string; service?: string; now?: Date };

const sha256Hex = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string): Buffer => createHmac("sha256", key).update(data).digest();

/** RFC 3986 encoding of one path segment (S3 wants `/` kept and everything else percent-encoded, upper-case hex). */
function encodeSegment(seg: string): string {
  return encodeURIComponent(seg).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalQuery(search: URLSearchParams): string {
  const pairs: [string, string][] = [];
  for (const [k, v] of search) pairs.push([encodeSegment(k), encodeSegment(v)]);
  pairs.sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1));
  return pairs.map(([k, v]) => `${k}=${v}`).join("&");
}

export function sigv4(
  req: { method: string; url: string; headers: Record<string, string>; body: Uint8Array | string },
  cfg: SigV4Config,
): Record<string, string> {
  const url = new URL(req.url);
  const region = cfg.region ?? "us-east-1";
  const service = cfg.service ?? "s3";
  const now = cfg.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // 20130524T000000Z
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(req.body);

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = v.trim().replace(/\s+/g, " ");
  headers.host ??= url.host;
  headers["x-amz-date"] = amzDate;
  headers["x-amz-content-sha256"] = payloadHash;

  const signedNames = Object.keys(headers).sort();
  const canonicalHeaders = signedNames.map((k) => `${k}:${headers[k] ?? ""}\n`).join("");
  const signedHeaders = signedNames.join(";");
  const canonicalUri = url.pathname
    .split("/")
    .map((seg) => encodeSegment(decodeURIComponent(seg)))
    .join("/");
  const canonicalRequest = [req.method.toUpperCase(), canonicalUri === "" ? "/" : canonicalUri, canonicalQuery(url.searchParams), canonicalHeaders, signedHeaders, payloadHash].join("\n");

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${cfg.secretKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

function assertKey(key: string): void {
  if (!STORAGE_KEY_RE.test(key) || key.split("/").some((seg) => seg === ".." || seg === "")) {
    throw new Error(`unsafe storage key: ${key}`);
  }
}

export function s3Storage(cfg: { endpoint: string; bucket: string; accessKey: string; secretKey: string; region?: string; publicBase: string }): StorageDriver {
  const endpoint = cfg.endpoint.replace(/\/$/, "");
  const publicBase = cfg.publicBase.replace(/\/$/, "");
  const objectUrl = (key: string): string => `${endpoint}/${cfg.bucket}/${key.split("/").map(encodeSegment).join("/")}`;
  const sign = (method: string, url: string, headers: Record<string, string>, body: Uint8Array | string): Record<string, string> =>
    sigv4({ method, url, headers, body }, { accessKey: cfg.accessKey, secretKey: cfg.secretKey, ...(cfg.region !== undefined ? { region: cfg.region } : {}) });

  async function call(method: string, key: string, body: Uint8Array | string = "", extra: Record<string, string> = {}): Promise<Response> {
    const url = objectUrl(key);
    const headers = sign(method, url, extra, body);
    const init: RequestInit = { method, headers, redirect: "error" };
    if (body !== "" && body.length > 0) init.body = body as NonNullable<RequestInit["body"]>;
    return fetch(url, init);
  }

  return {
    key: "s3",
    async put(storageKey, body, contentType, opts) {
      assertKey(storageKey);
      const res = await call("PUT", storageKey, body, {
        "content-type": contentType,
        "cache-control": opts?.cacheControl ?? "public, max-age=31536000, immutable",
        "content-length": String(body.byteLength),
      });
      if (!res.ok) throw new Error(`s3 put ${storageKey}: ${String(res.status)}`);
    },
    async get(storageKey) {
      assertKey(storageKey);
      const res = await call("GET", storageKey);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`s3 get ${storageKey}: ${String(res.status)}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    async exists(storageKey) {
      assertKey(storageKey);
      const res = await call("HEAD", storageKey);
      if (res.status === 404) return false;
      if (!res.ok) throw new Error(`s3 head ${storageKey}: ${String(res.status)}`);
      return true;
    },
    async delete(storageKey) {
      assertKey(storageKey);
      const res = await call("DELETE", storageKey);
      if (!res.ok && res.status !== 404) throw new Error(`s3 delete ${storageKey}: ${String(res.status)}`);
    },
    publicUrl(storageKey) {
      assertKey(storageKey);
      return `${publicBase}/${storageKey}`;
    },
  };
}
