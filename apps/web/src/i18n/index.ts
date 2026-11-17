import { faInt } from "@namilux/core/client";
import { fa } from "./fa";

export type FaKey = keyof typeof fa;

const VAR_RE = /\{(\w+)\}/g;

function isProduction(): boolean {
  // Read lazily so a test can flip NODE_ENV between cases.
  return process.env.NODE_ENV === "production";
}

function format(value: string | number): string {
  return typeof value === "number" ? faInt(value) : value;
}

export function t(key: FaKey, vars?: Record<string, string | number>): string {
  const template: string | undefined = Object.prototype.hasOwnProperty.call(fa, key)
    ? fa[key]
    : undefined;
  if (template === undefined) {
    if (!isProduction()) throw new Error(`i18n: unknown key "${String(key)}"`);
    return String(key);
  }
  if (vars === undefined) return template;
  return template.replace(VAR_RE, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? format(vars[name] as string | number) : whole,
  );
}

export function tn(n: number, key: FaKey): string {
  return t(key, { n });
}
