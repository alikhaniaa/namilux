#!/usr/bin/env bash
# Transactionally reconcile only the four application units and their old set-property memory overrides.
# Other overrides (security/credentials/etc.) are preserved. Backups also support a release rollback.
set -euo pipefail
action=${1:?install or restore}
source_dir=${2:?source directory for install; backup directory for restore}
backup=${3:-$source_dir}
unit_root=${UNIT_ROOT:-/etc/systemd/system}
control_root=${CONTROL_ROOT:-/etc/systemd/system.control}
units=(namilux-web namilux-admin namilux-worker)

restore_units() {
  local u setting
  for u in "${units[@]}"; do
    if [[ -f "$backup/$u.service" ]]; then
      install -m 644 "$backup/$u.service" "$unit_root/$u.service"
    elif [[ -f "$backup/$u.missing" ]]; then rm -f "$unit_root/$u.service"; fi
    for setting in MemoryHigh MemoryMax; do
      if [[ -f "$backup/$u.$setting" ]]; then
        mkdir -p "$control_root/$u.service.d"
        install -m 644 "$backup/$u.$setting" "$control_root/$u.service.d/50-$setting.conf"
      elif [[ -f "$backup/$u.$setting.missing" ]]; then
        rm -f "$control_root/$u.service.d/50-$setting.conf"
      fi
    done
  done
  systemctl daemon-reload
}

case "$action" in
  restore) [[ -d "$backup" ]] || exit 0; restore_units;;
  install)
    [[ ! -e "$backup" ]] || { echo 'unit backup already exists; refusing to overwrite rollback state' >&2; exit 1; }
    mkdir -m 700 -p "$backup"
    # Validate every source before touching the installed units.
    for u in "${units[@]}"; do [[ -f "$source_dir/$u.service" ]]; done
    for u in "${units[@]}"; do
      if [[ -f "$unit_root/$u.service" ]]; then cp -a "$unit_root/$u.service" "$backup/";
      else touch "$backup/$u.missing"; fi
      for setting in MemoryHigh MemoryMax; do
        p="$control_root/$u.service.d/50-$setting.conf"
        if [[ -f "$p" ]]; then cp -a "$p" "$backup/$u.$setting";
        else touch "$backup/$u.$setting.missing"; fi
      done
    done
    trap 'restore_units' ERR
    # Install authoritative limits FIRST. Only then remove the specific conflicting overrides.
    for u in "${units[@]}"; do install -m 644 "$source_dir/$u.service" "$unit_root/$u.service"; done
    for u in "${units[@]}"; do
      rm -f "$control_root/$u.service.d/50-MemoryHigh.conf" "$control_root/$u.service.d/50-MemoryMax.conf"
    done
    systemctl daemon-reload
    for u in "${units[@]}"; do
      for setting in MemoryHigh MemoryMax; do
        expected=$(sed -n "s/^$setting=//p" "$source_dir/$u.service" | numfmt --from=iec)
        actual=$(systemctl show "$u" -p "$setting" --value)
        [[ "$actual" == "$expected" ]] || { echo "$u $setting disagrees with release" >&2; false; }
      done
    done
    trap - ERR
    ;;
  *) echo 'expected install or restore' >&2; exit 2;;
esac
