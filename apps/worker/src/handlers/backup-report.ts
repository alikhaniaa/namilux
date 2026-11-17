import { readFile } from "node:fs/promises";
import { jobs } from "@namilux/core";
import type { Handler } from "../runtime";

const STALE_MS = 26 * 60 * 60 * 1000;
// infra/server/backup.sh publishes this copy for the worker: the backups directory itself is root-only.
const DEFAULT_PATH = "/opt/namilux/backup-status.json";

type BackupStatus = { at?: string; ok?: boolean; bytes?: number; error?: string };

export const backupReport: Handler = async ({ db, log }) => {
  const path = process.env.BACKUP_STATUS_PATH ?? DEFAULT_PATH;
  const day = new Date().toISOString().slice(0, 10);

  async function alert(error: string): Promise<void> {
    await jobs.enqueue(db, "telegram.notify", { kind: "backup.result", ok: false, error }, { uniqueKey: `backup.result:${day}` });
    log.warn({ error }, "backup report: alerting");
  }

  let status: BackupStatus;
  try {
    status = JSON.parse(await readFile(path, "utf8")) as BackupStatus;
  } catch {
    await alert("status file missing or unreadable");
    return;
  }

  if (status.ok !== true) {
    await alert(status.error ?? "backup reported failure");
    return;
  }
  const at = status.at !== undefined ? Date.parse(status.at) : Number.NaN;
  if (!Number.isFinite(at) || Date.now() - at > STALE_MS) {
    await alert(`backup stale (last at ${status.at ?? "unknown"})`);
    return;
  }
  log.info({ at: status.at, bytes: status.bytes ?? 0 }, "backup healthy");
};
