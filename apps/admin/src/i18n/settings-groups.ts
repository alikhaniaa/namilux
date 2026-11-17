/** Persian names of the settings groups (3 Sep 2026 walkthrough: the index and group pages showed raw keys). */
import { fa } from "./fa";

/** Name of a settings group; falls back to the key for one the dictionary does not know yet. */
export function groupLabel(key: string): string {
  const k = `settingsGroup.${key}` as keyof typeof fa;
  return k in fa ? fa[k] : key;
}

/**
 * Persian names of the fields INSIDE a group object (SettingsForm renders one input per key and
 * falls back to the raw key). Only the keys the dictionary knows are listed; anything else keeps
 * its English name, exactly as before.
 */
export function fieldLabels(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fa)) {
    if (k.startsWith("settingsField.")) out[k.slice("settingsField.".length)] = v;
  }
  return out;
}
