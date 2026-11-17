import { z } from "zod";
import { EVENT_TYPES, UA_CLASSES } from "../constants";
import { clean, zId, zIsoDate, zText, FA } from "./common";

export const beaconPathSchema = z.preprocess(
  clean,
  z
    .string()
    .max(512, FA.tooLong)
    .regex(/^\/[^\s?#]*$/, FA.invalid),
);

export const beaconPropsSchema = z
  .record(
    z.string().regex(/^[a-z0-9_]{1,32}$/, FA.invalid),
    z.union([z.string().max(120, FA.tooLong), z.number().finite(), z.boolean()]),
  )
  .refine((r) => Object.keys(r).length <= 10, FA.tooLong);

export const beaconSchema = z
  .object({
    t: z.enum(EVENT_TYPES),
    p: beaconPathSchema,
    r: zText(512).optional(),
    pid: zId.optional(),
    s: z.string().regex(/^[0-9a-f]{16,64}$/, FA.invalid),
    ua: z.enum(UA_CLASSES),
    x: beaconPropsSchema.optional(),
  })
  .strict();

export const cspLegacyReportSchema = z
  .object({
    "csp-report": z.looseObject({
      "document-uri": z.string().max(2048).optional(),
      referrer: z.string().max(2048).optional(),
      "violated-directive": z.string().max(200).optional(),
      "effective-directive": z.string().max(200).optional(),
      "original-policy": z.string().max(4096).optional(),
      "blocked-uri": z.string().max(2048).optional(),
      "source-file": z.string().max(2048).optional(),
      "line-number": z.number().optional(),
      "column-number": z.number().optional(),
      "status-code": z.number().optional(),
      disposition: z.string().max(20).optional(),
    }),
  })
  .strict();

export const cspReportingApiSchema = z
  .array(
    z
      .object({
        type: z.literal("csp-violation"),
        age: z.number().optional(),
        url: z.string().max(2048).optional(),
        user_agent: z.string().max(512).optional(),
        body: z.looseObject({}),
      })
      .strict(),
  )
  .max(10, FA.tooLong);

export const cspReportSchema = z.union([cspLegacyReportSchema, cspReportingApiSchema]);

const MAX_RANGE_DAYS = 400;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export const dashboardRangeSchema = z.union([
  z.enum(["today", "7d", "30d"]),
  z
    .object({ from: zIsoDate, to: zIsoDate })
    .strict()
    .refine((r) => r.from <= r.to && daysBetween(r.from, r.to) <= MAX_RANGE_DAYS, { message: FA.invalid, path: ["to"] }),
]);

export const analyticsQuerySchema = z
  .object({
    range: dashboardRangeSchema.default("7d"),
    metric: z
      .enum(["sessions", "pageviews", "funnel", "search_terms", "installs", "sources", "devices", "top_pages"])
      .optional(),
  })
  .strict();

export type BeaconInput = z.infer<typeof beaconSchema>;
export type CspReportInput = z.infer<typeof cspReportSchema>;
export type DashboardRangeInput = z.infer<typeof dashboardRangeSchema>;
export type AnalyticsQueryInput = z.infer<typeof analyticsQuerySchema>;
