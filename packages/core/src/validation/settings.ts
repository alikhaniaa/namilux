import { z } from "zod";
import { SETTINGS_KEYS } from "../settings/schema";

// DECISION (M0 step 3): settings/schema.ts exports the per-key record as
// `settingsKeySchemas`; the spec §validation names it `settingsSchemas`, so it is re-exported under
// that name here. `settingsKeySchema` (the key enum) and `setSettingSchema` (the
// `PUT /api/settings/:key` body) are request-shape schemas, so they are defined in this namespace - 
// no settings *shape* is duplicated.
export { settingsKeySchemas as settingsSchemas, parseSettingValue } from "../settings/schema";

export const settingsKeySchema = z.enum(SETTINGS_KEYS);

export const setSettingSchema = z.object({ value: z.unknown() }).strict();

export const settingKeyParamSchema = z.object({ key: settingsKeySchema }).strict();
export type SettingKeyParam = z.infer<typeof settingKeyParamSchema>;
