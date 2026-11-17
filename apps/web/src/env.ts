import "server-only";
import { webEnv } from "@namilux/config";

// Parsed at module load: a missing or malformed variable must fail the process at startup, loudly,
// not at the first request that happens to need it.
export const env = webEnv();
