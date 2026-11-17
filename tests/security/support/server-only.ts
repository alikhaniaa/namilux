/** Test shim for the `server-only` marker package: the real one throws outside a React server bundle; here it must be a no-op so `apps/web` server modules can be imported under vitest. */
export {};
