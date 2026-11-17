/**
 * A counting permit with a *non-blocking* acquire.
 *
 * Deliberately not a queue of waiters: a slot that cannot get the permit claims a different job
 * type instead of parking, so limiting image work to one at a time never leaves an order, a
 * payment settlement or an SMS waiting behind a 300-second media job. The database queue is the
 * only backlog in this design; the gate never becomes a second one.
 */
export type Gate = {
  tryAcquire(): boolean;
  release(): void;
  /** Permits currently available - for tests and for logging, never for a check-then-act. */
  readonly free: number;
};

export function createGate(size: number): Gate {
  const capacity = Math.max(1, Math.trunc(size));
  let free = capacity;
  return {
    tryAcquire() {
      if (free <= 0) return false;
      free -= 1;
      return true;
    },
    release() {
      // Clamped: a double release must not manufacture a permit that lets two media jobs overlap.
      free = Math.min(capacity, free + 1);
    },
    get free() {
      return free;
    },
  };
}
