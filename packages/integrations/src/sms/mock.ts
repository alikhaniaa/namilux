import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import type { SmsDriver } from "./types";
import { segmentsFor } from "./segments";

export function mockSmsDriver(cfg: { outboxPath: string }): SmsDriver {
  return {
    key: "mock",
    async send(to, text) {
      const at = new Date().toISOString();
      const line = `${JSON.stringify({ to, text, at })}\n`;
      await mkdir(dirname(cfg.outboxPath), { recursive: true });
      await appendFile(cfg.outboxPath, line, "utf8");
      // Visible in the dev/e2e log so Playwright (and humans) can read the OTP code.
      // eslint-disable-next-line no-console -- the mock driver's whole purpose is to print to the dev log
      console.log(`[sms.mock] → ${to}: ${text}`);
      return {
        ok: true,
        providerRef: `mock-${Date.now()}-${randomBytes(4).toString("hex")}`,
        segments: segmentsFor(text),
        costToman: 0,
      };
    },
  };
}

export async function readLastMockSms(
  outboxPath: string,
  to: string,
): Promise<{ text: string; at: string } | null> {
  let raw: string;
  try {
    raw = await readFile(outboxPath, "utf8");
  } catch {
    return null;
  }
  const lines = raw.split("\n").filter((l) => l.trim() !== "");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (line === undefined) continue;
    try {
      const row = JSON.parse(line) as { to: string; text: string; at: string };
      if (row.to === to) return { text: row.text, at: row.at };
    } catch {
      // skip malformed lines
    }
  }
  return null;
}
