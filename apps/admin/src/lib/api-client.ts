"use client";

import { ERROR_REASONS, fieldErrorsFromDetails, readableErrorText } from "./error-detail";
import type { FieldError } from "./error-detail";

/**
 * The browser half of the admin error contract.
 *
 * A failure keeps everything a screen needs to explain itself - the core code, the stable reason,
 * the request ref and the field errors - and its `message` is already the readable Persian line
 * (reason + recovery + the support diagnostic), so every caller that only does `toast(e.message)`
 * keeps working and gets better copy.
 */
export class ApiError extends Error {
  override readonly name = "ApiError";
  readonly code: string;
  readonly details: unknown;
  readonly status: number | undefined;
  readonly ref: string | undefined;
  readonly reason: string | undefined;
  /** The same line without the per-field corrections, for a screen that lists the fields itself. */
  readonly brief: string;

  constructor(
    code: string,
    message: string,
    details?: unknown,
    init?: { status?: number | undefined; ref?: string | undefined; reason?: string | undefined; brief?: string | undefined },
  ) {
    super(message);
    this.code = code;
    this.details = details;
    this.status = init?.status;
    this.ref = init?.ref;
    this.reason = init?.reason;
    this.brief = init?.brief ?? message;
  }

  get sudoRequired(): boolean {
    return typeof this.details === "object" && this.details !== null && (this.details as { sudoRequired?: boolean }).sudoRequired === true;
  }

  /** Field-level problems the server named, ready to merge into a form's own error map. */
  get fieldErrors(): FieldError[] {
    return fieldErrorsFromDetails(this.details);
  }
}

function csrfToken(): string {
  if (typeof document === "undefined") return "";
  for (const part of document.cookie.split(";")) {
    const eq = part.indexOf("=");
    if (eq !== -1 && part.slice(0, eq).trim() === "nl_c") return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return "";
}

type Json = Record<string, unknown> | unknown[] | undefined;

type ApiEnvelope<T> = {
  ok?: boolean;
  data?: T;
  error?: { code?: unknown; message?: unknown; ref?: unknown; reason?: unknown; details?: unknown };
};

/** Registered by shell/SudoDialog: resolves true once a fresh sudo cookie is set, false when dismissed. */
let sudoHandler: (() => Promise<boolean>) | null = null;
export function setSudoHandler(h: (() => Promise<boolean>) | null): void {
  sudoHandler = h;
}

export type RevalidateEvent = { tags: string[]; at: number };
export const REVALIDATE_EVENT = "nl:revalidate";

/** A refusal, read back into the one error shape every caller catches. */
function errorFromResponse(status: number, body: unknown, headerRef: string | null): ApiError {
  const envelope = typeof body === "object" && body !== null ? (body as ApiEnvelope<unknown>) : {};
  const raw = typeof envelope.error === "object" && envelope.error !== null ? envelope.error : {};
  const code = typeof raw.code === "string" && raw.code !== "" ? raw.code : "INTERNAL";
  const reason = typeof raw.reason === "string" && raw.reason !== "" ? raw.reason : undefined;
  // The body carries the ref on every handler refusal; the header is the fallback for a response
  // that never reached the handler (an edge 502, say).
  const ref = (typeof raw.ref === "string" && raw.ref !== "" ? raw.ref : undefined) ?? headerRef ?? undefined;
  const message = typeof raw.message === "string" && raw.message !== "" ? raw.message : undefined;
  const details = raw.details;
  const shape = { code, message, reason, ref, details };
  return new ApiError(code, readableErrorText(shape), details, { status, ref, reason, brief: readableErrorText(shape, { withFields: false }) });
}

/** fetch itself failed: offline, DNS, aborted. There is nothing to retry automatically. */
function transportError(err: unknown): ApiError {
  const name = typeof err === "object" && err !== null && "name" in err ? (err as { name?: unknown }).name : undefined;
  const reason = name === "AbortError" ? ERROR_REASONS.REQUEST_CANCELLED : ERROR_REASONS.NETWORK;
  return new ApiError("INTERNAL", readableErrorText({ code: "INTERNAL", reason }), undefined, { reason });
}

/** The response was not the JSON envelope (truncated, HTML error page, empty body). */
function badResponse(status: number, headerRef: string | null): ApiError {
  const ref = headerRef ?? undefined;
  return new ApiError("INTERNAL", readableErrorText({ code: "INTERNAL", reason: ERROR_REASONS.BAD_RESPONSE, ref }), undefined, {
    status,
    ref,
    reason: ERROR_REASONS.BAD_RESPONSE,
  });
}

async function send(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(path, { credentials: "same-origin", ...init });
  } catch (err) {
    throw transportError(err);
  }
}

async function readEnvelope<T>(res: Response): Promise<T> {
  const headerRef = res.headers.get("x-request-id");
  if (res.status === 204) return undefined as T;
  let json: ApiEnvelope<T>;
  try {
    json = (await res.json()) as ApiEnvelope<T>;
  } catch {
    throw badResponse(res.status, headerRef);
  }
  // `null`, a bare string or a list parses as JSON but is not the envelope either.
  if (typeof json !== "object" || json === null || Array.isArray(json)) throw badResponse(res.status, headerRef);
  if (!res.ok || json.ok === false || json.error !== undefined) throw errorFromResponse(res.status, json, headerRef);
  return json.data as T;
}

async function request<T>(path: string, init: { method?: string; body?: Json; headers?: Record<string, string> } | undefined): Promise<T> {
  const method = init?.method ?? "GET";
  const mutating = method !== "GET" && method !== "HEAD";
  const headers: Record<string, string> = { ...(init?.headers ?? {}) };
  if (init?.body !== undefined) headers["content-type"] = "application/json";
  if (mutating) headers["x-nl-csrf"] = csrfToken();

  const res = await send(path, {
    method,
    headers,
    ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const data = await readEnvelope<T>(res);

  // Success only: a refusal must never look like a completed write to the revalidation chip.
  const revalidated = res.headers.get("x-revalidate");
  if (revalidated !== null && revalidated !== "" && typeof window !== "undefined") {
    const detail: RevalidateEvent = { tags: revalidated.split(","), at: Date.now() };
    window.dispatchEvent(new CustomEvent<RevalidateEvent>(REVALIDATE_EVENT, { detail }));
  }
  return data;
}

export async function api<T = unknown>(
  path: string,
  init?: { method?: string; body?: Json; headers?: Record<string, string> },
): Promise<T> {
  try {
    return await request<T>(path, init);
  } catch (err) {
    // The ONE retry the client performs: a sudo refusal, once a fresh TOTP has been verified.
    // Mutations are never retried on their own - a network failure may have reached the server.
    if (err instanceof ApiError && err.sudoRequired && sudoHandler !== null) {
      const ok = await sudoHandler();
      if (ok) return request<T>(path, init);
    }
    throw err;
  }
}

/** Multipart upload through the same CSRF + envelope path (media uploads). */
export async function apiUpload<T = unknown>(path: string, form: FormData): Promise<T> {
  const res = await send(path, { method: "POST", headers: { "x-nl-csrf": csrfToken() }, body: form });
  return readEnvelope<T>(res);
}
