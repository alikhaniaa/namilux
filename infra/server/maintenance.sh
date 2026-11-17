#!/usr/bin/env bash
# Shared by the release and watchdog. flock ownership, not a timestamp, proves a build is alive.
# A crashed deploy leaves harmless marker files: the watchdog ignores/removes them after lock release.
MAINTENANCE_STATE=${MAINTENANCE_STATE:-/run/namilux-watchdog}

maintenance_begin() {
  mkdir -p "$MAINTENANCE_STATE"
  exec 8>"$MAINTENANCE_STATE/build.lock"
  flock -n 8 || { echo 'another build holds the maintenance lock' >&2; return 1; }
}

maintenance_mark() { touch "$MAINTENANCE_STATE/$1.paused"; }
maintenance_clear() { rm -f "$MAINTENANCE_STATE/$1.paused"; }

maintenance_active() {
  local unit=$1
  [[ -f "$MAINTENANCE_STATE/$unit.paused" ]] || return 1
  # A separate descriptor tests the live lock without affecting the builder's descriptor.
  if ! flock -n "$MAINTENANCE_STATE/build.lock" true; then return 0; fi
  maintenance_clear "$unit"
  return 1
}
