import "server-only";
import { adminEnv } from "@namilux/config";

// Parsed at module load: a missing or malformed variable fails the process at startup, loudly.
export const env = adminEnv();
