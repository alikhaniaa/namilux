import "server-only";
import { clientIpFromHeaders } from "@namilux/config/client-ip";
import { AppError, ERROR_FA, assertCan, channelScope, isAppError, requiresSudo, ulid, verifySudoToken } from "@namilux/core";
import type { ErrorCode, Permission, StaffUser } from "@namilux/core";
import type { z } from "zod";
import { SUDO_COOKIE } from "@namilux/core";
import { currentStaff } from "./session";
import { csrfCheck } from "./csrf";
import { sudoRequired } from "./authz";
import { send as revalidateSend } from "./revalidate-client";
import { ERROR_REASONS, fieldErrorsFromIssues, reasonMessage } from "./error-detail";
import { env } from "@/env";

const DEFAULT_BODY_CAP = 64 * 1024;
const MUST_CHANGE_FA = "اول باید گذرواژهٔ یک‌بارمصرف را عوض کنید";
const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;
const NO_STORE = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } as const;

export type AdminHandlerCtx<I> = {
  input: I;
  staff: StaffUser;
  ip: string;
  req: Request;
  params: Record<string, string>;
};
export type AdminHandlerSpec<S extends z.ZodTypeAny | undefined, R> = {
  schema?: S;
  validationErrors?: (error: z.ZodError) => Record<string, string>;
  permission: Permission;
  /**
   * The route reads or writes data that is not per storefront (events-based analytics, the inbox,
   * the media library…): a staff member confined to one site (authz ROLE_CHANNEL) is refused here
   * even when the permission itself is theirs.
   */
  bothSites?: boolean;
  sudo?: boolean;
  bodyCap?: number;
  run: (ctx: AdminHandlerCtx<S extends z.ZodTypeAny ? z.infer<S> : undefined>) => Promise<R & { revalidate?: string[] }>;
};

export function ok<T>(data: T, init?: { status?: number; headers?: HeadersInit }): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: init?.status ?? 200,
    headers: { ...NO_STORE, ...(init?.headers ?? {}) },
  });
}

/** Server-side record of an unexpected (non-AppError) failure: the client only ever sees INTERNAL + the request id. */
export function logInternal(ref: string, e: unknown): void {
  const err = e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : { value: String(e) };
  // eslint-disable-next-line no-console -- the one place an unexpected server error is recorded (pino-shaped line on stderr)
  console.error(JSON.stringify({ level: 50, app: "admin", ref, msg: "internal error", err }));
}

export function fail(e: AppError, ref?: string, reason?: string): Response {
  const error: Record<string, unknown> = { code: e.code, message: e.fa };
  if (ref !== undefined) error.ref = ref;
  if (reason !== undefined) error.reason = reason;
  // `details` is passed through untouched: core routes already publish shapes here (a field name, an
  // issue list, `sudoRequired`), and the diagnostic reason rides beside it rather than inside it.
  if (e.details !== undefined) error.details = e.details;
  return new Response(JSON.stringify({ ok: false, error }), {
    status: e.httpStatus,
    headers: ref === undefined ? NO_STORE : { ...NO_STORE, "X-Request-Id": ref },
  });
}

/**
 * The reason a plain `AppError` maps to when the thrower did not name one, so every failure the
 * client sees carries a stable diagnostic even for the older routes that only pick a core code.
 */
const CODE_REASON: Partial<Record<ErrorCode, string>> = {
  VALIDATION: ERROR_REASONS.VALIDATION,
  UNAUTHORIZED: ERROR_REASONS.SESSION_REQUIRED,
  FORBIDDEN: ERROR_REASONS.PERMISSION_DENIED,
  NOT_FOUND: ERROR_REASONS.NOT_FOUND,
  CONFLICT: ERROR_REASONS.CONFLICT,
  RATE_LIMITED: ERROR_REASONS.RATE_LIMITED,
  INTERNAL: ERROR_REASONS.INTERNAL,
};

function reasonForCode(code: ErrorCode): string {
  return CODE_REASON[code] ?? code;
}

function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.get("cookie");
  if (raw === null) return undefined;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/**
 * Reads a request body up to `cap` bytes. Returns null - without buffering the rest - when the
 * declared Content-Length or the bytes actually received exceed the cap.
 */
export async function readBodyCapped(req: Request, cap: number): Promise<string | null> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > cap) return null;
  if (req.body === null) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function clientIp(req: Request): string {
  // Last hop of X-Forwarded-For behind the trusted edge - the first hop is whatever the client sent.
  return clientIpFromHeaders(req.headers, env.TRUST_PROXY);
}

export function sameOrigin(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin" && site !== "none") return false;
  const origin = req.headers.get("origin");
  return origin === null || origin === env.ADMIN_ORIGIN;
}

/**
 * The handler a route exports, with the permission it asserts readable from the outside. The
 * property is what the route-guard audit test walks: every exported HTTP verb under `app/api` has
 * to carry one, so a new route cannot be added without declaring what it costs.
 */
export type AdminRouteHandler = ((req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>) & {
  readonly permission: Permission;
};

export function adminHandler<S extends z.ZodTypeAny | undefined, R>(spec: AdminHandlerSpec<S, R>): AdminRouteHandler {
  const handler = async (req: Request, ctx: { params: Promise<Record<string, string>> }): Promise<Response> => {
    // An edge-assigned id is kept so the logs line up; anything not id-shaped is caller text and is
    // replaced rather than echoed into the body and the header.
    const incomingId = req.headers.get("x-request-id");
    const requestId = incomingId !== null && REQUEST_ID.test(incomingId) ? incomingId : ulid();
    try {
      const params = await ctx.params;
      const mutating = req.method !== "GET" && req.method !== "HEAD";

      if (mutating) {
        if (!sameOrigin(req)) {
          return fail(new AppError("FORBIDDEN", 403, reasonMessage(ERROR_REASONS.ORIGIN_REJECTED)), requestId, ERROR_REASONS.ORIGIN_REJECTED);
        }
        if (!csrfCheck(req)) {
          return fail(new AppError("FORBIDDEN", 403, reasonMessage(ERROR_REASONS.CSRF_EXPIRED)), requestId, ERROR_REASONS.CSRF_EXPIRED);
        }
      }

      // The cap is enforced while streaming: an oversized body is dropped after `cap` bytes instead
      // of being buffered whole and measured afterwards.
      let raw = "";
      if (mutating) {
        const body = await readBodyCapped(req, spec.bodyCap ?? DEFAULT_BODY_CAP);
        if (body === null) {
          return fail(new AppError("VALIDATION", 413, reasonMessage(ERROR_REASONS.BODY_TOO_LARGE)), requestId, ERROR_REASONS.BODY_TOO_LARGE);
        }
        raw = body;
      }

      const staff = await currentStaff();
      if (staff === null) return fail(new AppError("UNAUTHORIZED", 401, ERROR_FA.UNAUTHORIZED), requestId, ERROR_REASONS.SESSION_REQUIRED);
      // The forced first-login password change, enforced on the server as well as in the shell: an
      // account still holding its one-time password reaches nothing but /api/account/password
      // (hand-written, so not this handler) and the logout.
      if (staff.mustChangePassword) {
        return fail(new AppError("FORBIDDEN", 403, MUST_CHANGE_FA), requestId, ERROR_REASONS.PASSWORD_CHANGE_REQUIRED);
      }

      try {
        assertCan(staff, spec.permission);
        if (spec.bothSites === true && channelScope(staff) !== null) throw new AppError("FORBIDDEN", 403, ERROR_FA.FORBIDDEN);
      } catch (e) {
        // A permission refusal is the one FORBIDDEN the guard itself writes: name it as such.
        if (isAppError(e)) return fail(e, requestId, ERROR_REASONS.PERMISSION_DENIED);
        throw e;
      }
      const needSudo = spec.sudo ?? requiresSudo(spec.permission);
      if (needSudo) {
        const token = readCookie(req, SUDO_COOKIE);
        if (token === undefined || verifySudoToken(token, staff.sessionId, env.SESSION_PEPPER) === null) {
          return fail(sudoRequired(spec.permission), requestId, ERROR_REASONS.SUDO_REQUIRED);
        }
      }

      let input: unknown;
      if (spec.schema !== undefined) {
        let parsedJson: unknown;
        if (raw !== "") {
          try {
            parsedJson = JSON.parse(raw);
          } catch {
            return fail(new AppError("VALIDATION", 400, reasonMessage(ERROR_REASONS.INVALID_JSON)), requestId, ERROR_REASONS.INVALID_JSON);
          }
        }
        const parsed = spec.schema.safeParse(parsedJson);
        if (!parsed.success) {
          // A route may translate its own issues (only /api/staff does, for the initial password):
          // that map is the headline message and keeps riding under `details.fields`, the shape its
          // caller reads. Its wording also wins for the pairs below, so the form shows the precise
          // sentence rather than the generic one for the same field.
          const named = spec.validationErrors?.(parsed.error);
          const fields = named !== undefined && Object.keys(named).length > 0 ? named : undefined;
          // The body is handed to the redactor so a message that repeats a value the caller sent
          // is never shipped back; each path is rebuilt from schema-shaped segments only.
          const generic = fieldErrorsFromIssues(parsed.error.issues, parsedJson);
          const fieldErrors =
            fields === undefined
              ? generic
              : generic.map((f) => {
                  const override = Object.hasOwn(fields, f.path) ? fields[f.path] : undefined;
                  return override === undefined ? f : { ...f, message: override };
                });
          const details: Record<string, unknown> = {};
          if (fieldErrors.length > 0) details.fieldErrors = fieldErrors;
          if (fields !== undefined) details.fields = fields;
          const message = fields === undefined ? reasonMessage(ERROR_REASONS.FIELD_VALIDATION) : Object.values(fields)[0] ?? reasonMessage(ERROR_REASONS.FIELD_VALIDATION);
          return fail(
            new AppError("VALIDATION", 400, message, Object.keys(details).length === 0 ? undefined : details),
            requestId,
            ERROR_REASONS.FIELD_VALIDATION,
          );
        }
        input = parsed.data;
      }

      const result = await spec.run({
        input: input as S extends z.ZodTypeAny ? z.infer<S> : undefined,
        staff,
        ip: clientIp(req),
        req,
        params,
      });
      const { revalidate, ...data } = result as R & { revalidate?: string[] };
      const headers: Record<string, string> = { "X-Request-Id": requestId };
      if (revalidate !== undefined && revalidate.length > 0) {
        void revalidateSend(revalidate);
        // The shell's RevalidateStatus chip reads the tags off this module; the body
        // keeps the plain envelope every route promises.
        headers["X-Revalidate"] = revalidate.join(",");
      }
      return ok(data, { headers });
    } catch (e) {
      if (isAppError(e)) return fail(e, requestId, reasonForCode(e.code));
      logInternal(requestId, e);
      return fail(new AppError("INTERNAL", 500, ERROR_FA.INTERNAL), requestId, ERROR_REASONS.INTERNAL);
    }
  };
  return Object.defineProperty(handler, "permission", { value: spec.permission, enumerable: true }) as AdminRouteHandler;
}
