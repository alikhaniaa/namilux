#!/usr/bin/env bash
# Linux/root fixture only: no live database, services, network or customer data.
# PostgreSQL and sudo are strict local stubs; age encryption and tar/checksums are real.
set -euo pipefail
umask 077
[[ $(uname -s) == Linux && $EUID == 0 ]] || {
  echo 'Run this isolated fixture as root on Linux; it does not use the live installation.' >&2
  exit 2
}
for tool in age age-keygen bash python3 tar gzip sha256sum flock realpath stat mktemp; do
  command -v "$tool" >/dev/null || { echo "Missing fixture dependency: $tool" >&2; exit 2; }
done
here=$(cd -- "$(dirname -- "$0")/.." && pwd)
exporter=$here/export.sh
[[ -f $exporter ]] || { echo 'Missing sibling export.sh' >&2; exit 2; }
temp=$(mktemp -d /tmp/namilux-customer-export-test.XXXXXXXX)
temp=$(realpath -e -- "$temp")
[[ $temp == /tmp/namilux-customer-export-test.* && ! -L $temp &&
   $(stat -c %u "$temp") == 0 && $(stat -c %a "$temp") == 700 ]] || exit 2
cleanup_fixture() {
  result=$?
  trap - EXIT
  resolved=$(realpath -e -- "$temp") || exit 1
  if [[ $resolved == "$temp" && $resolved == /tmp/namilux-customer-export-test.* &&
        -d $resolved && ! -L $resolved && $(stat -c %u "$resolved") == 0 ]]; then
    rm -rf -- "$resolved"
  else
    echo 'Refusing fixture cleanup outside the verified private /tmp directory.' >&2
    result=1
  fi
  exit "$result"
}
trap cleanup_fixture EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
fail() { echo "FAIL: $*" >&2; exit 1; }
passes=0
pass() { passes=$((passes+1)); printf 'ok %s - %s\n' "$passes" "$1"; }
id() { printf '20261008T010203Z-%032x' "$1"; }

export NAMILUX_BACKUP_ROOT=$temp/root NAMILUX_BACKUP_OUT=$temp/out NAMILUX_BACKUP_ETC=$temp/etc
export FIXTURE_BIN=$temp/bin FIXTURE_CALLS=$temp/calls FIXTURE_UNEXPECTED=$temp/unexpected
export FIXTURE_MEDIA_SQL=$temp/media-rows.sql FIXTURE_RUN_ID= FAIL_DUMP=0
mkdir -m 700 "$FIXTURE_BIN" "$NAMILUX_BACKUP_ROOT" "$NAMILUX_BACKUP_OUT" "$NAMILUX_BACKUP_ETC"
export PATH=$FIXTURE_BIN:$PATH
root=$NAMILUX_BACKUP_ROOT
out=$NAMILUX_BACKUP_OUT
release=$root/releases/fixture-release
media=$root/media
etc_dir=$NAMILUX_BACKUP_ETC
mkdir -p "$release/apps/web/src" "$release/node_modules" "$release/apps/web/node_modules" \
  "$release/apps/web/.next" "$release/apps/admin/.next-fixture" "$release/.git" \
  "$release/.codex" "$release/.unit-backup" "$release/KEYS" "$root/bin" "$media/images" "$media/media" \
  "$etc_dir/caddy" "$etc_dir/postgresql/16/main" "$etc_dir/systemd/system" \
  "$etc_dir/systemd/system/namilux-worker.service.d" \
  "$etc_dir/systemd/system/caddy.service.d" "$etc_dir/systemd/system.control/caddy.service.d"
ln -s "$release" "$root/current"
printf '{"name":"fixture-release","private":true}\n' > "$release/package.json"
printf 'export default "fixture source";\n' > "$release/apps/web/src/page.ts"
for file in node_modules/dependency.js apps/web/node_modules/dependency.js apps/web/.next/server.js \
  apps/admin/.next-fixture/server.js .git/HEAD .codex/note .unit-backup/unit KEYS/key .env.fixture debug.log; do
  printf 'excluded fixture\n' > "$release/$file"
done
printf 'MEDIA_DIR=%s\nFIXTURE_SECRET=synthetic-only\n' "$media" > "$root/.env"
# Export must parse .env as data rather than execute its shell contents.
printf 'DO_NOT_EXECUTE=$(touch "%s")\n' "$temp/env-was-executed" >> "$root/.env"
printf '#!/bin/sh\n# fixture server script; never executed\n' > "$root/bin/release.sh"
printf 'fixture Caddyfile\n' > "$etc_dir/caddy/Caddyfile"
printf 'fixture PostgreSQL configuration\n' > "$etc_dir/postgresql/16/main/postgresql.conf"
printf '[Service]\n# fixture web unit\n' > "$etc_dir/systemd/system/namilux-web.service"
printf '[Timer]\n# fixture backup timer\n' > "$etc_dir/systemd/system/namilux-backup.timer"
printf '[Service]\nMemoryMax=123M\n' > "$etc_dir/systemd/system/namilux-worker.service.d/override.conf"
printf '[Service]\n# fixture caddy unit\n' > "$etc_dir/systemd/system/caddy.service"
printf '[Service]\nMemoryMax=234M\n' > "$etc_dir/systemd/system/caddy.service.d/override.conf"
printf '[Service]\nMemoryMax=345M\n' > "$etc_dir/systemd/system.control/caddy.service.d/50-MemoryMax.conf"
printf 'original fixture image\n' > "$media/images/original.jpg"
printf 'small fixture rendition\n' > "$media/images/small.webp"
printf 'large fixture rendition\n' > "$media/images/large.webp"
printf 'literal media-prefix fixture image\n' > "$media/media/logo.jpg"

cat > "$FIXTURE_BIN/dispatch" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
cmd=$(basename -- "$0")
printf '%s\n' "$cmd" >> "$FIXTURE_CALLS"
reject() {
  printf '%s rejected unexpected arguments\n' "$cmd" >> "$FIXTURE_UNEXPECTED"
  echo "Fixture refuses unexpected $cmd invocation." >&2
  exit 90
}
dump=$NAMILUX_BACKUP_OUT/$FIXTURE_RUN_ID/work/database.dump
case "$cmd" in
  sudo)
    [[ $# -ge 3 && $1 == -u && $2 == postgres ]] || reject
    shift 2
    [[ $1 == pg_dump || $1 == psql ]] || reject
    next=$1
    shift
    exec "$FIXTURE_BIN/$next" "$@"
    ;;
  pg_dump)
    if [[ $# == 1 && $1 == --version ]]; then
      printf 'pg_dump (PostgreSQL) 16.0 fixture\n'
    elif [[ $# == 4 && $1 == -Fc && $2 == --no-owner &&
            $3 == --lock-wait-timeout=15s && $4 == namilux ]]; then
      printf 'FIXTURE-DATABASE-DUMP\n'
      [[ $FAIL_DUMP != 1 ]] || { echo 'Injected pg_dump failure' >&2; exit 71; }
    else reject; fi
    ;;
  pg_restore)
    if [[ $# == 2 && $1 == --list && $2 == "$dump" && -s $dump ]]; then
      printf '; fixture pg_restore archive contents\n'
    elif [[ $# == 4 && $1 == --data-only && $2 == --table=media &&
            $3 == "--file=$NAMILUX_BACKUP_OUT/$FIXTURE_RUN_ID/work/media-rows.sql" &&
            $4 == "$dump" && -s $dump ]]; then
      cp -- "$FIXTURE_MEDIA_SQL" "$NAMILUX_BACKUP_OUT/$FIXTURE_RUN_ID/work/media-rows.sql"
    else reject; fi
    ;;
  psql)
    [[ $# == 10 && $1 == -X && $2 == -q && $3 == -t && $4 == -A &&
       $5 == -v && $6 == ON_ERROR_STOP=1 && $7 == -d && $8 == namilux && $9 == -c ]] || reject
    shift 9
    case "$1" in
      'SELECT pg_database_size(current_database())') printf '1024\n';;
      "BEGIN READ ONLY; SELECT coalesce(json_agg(r),'[]'::json) FROM (SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname IN ('nl_migrate','nl_web','nl_admin','nl_worker') ORDER BY rolname)r; COMMIT;")
        printf '[{"rolname":"nl_web","rolsuper":false,"rolcreatedb":false,"rolcreaterole":false,"rolbypassrls":false}]\n';;
      *) reject;;
    esac
    ;;
  node|pnpm)
    [[ $# == 1 && $1 == --version ]] || reject
    printf 'fixture-version\n'
    ;;
  *) reject;;
esac
STUB
chmod 700 "$FIXTURE_BIN/dispatch"
for tool in sudo pg_dump pg_restore psql node pnpm; do
  ln -s dispatch "$FIXTURE_BIN/$tool"
done

make_rows() {
  python3 - "$FIXTURE_MEDIA_SQL" "$1" <<'PY'
import json,pathlib,sys
scenario=sys.argv[2]
rows=[('original','images/original.jpg',
       {'small':{'webp':'images/small.webp'},'large':['images/large.webp'],'logo':'media/logo.jpg'},None),
      ('literal-prefix','media/logo.jpg',{'small':'images/small.webp'},None)]
if scenario=='tombstone':
    rows.append(('rejected','tmp/rejected-upload.png',{}, {'quarantined':True,'reason':'fixture rejection'}))
elif scenario=='tombstone-no-reason':
    rows.append(('rejected','tmp/rejected-upload.png',{}, {'quarantined':True}))
elif scenario=='quarantined-rendition':
    rows.append(('quarantined','images/original.jpg',{'webp':'images/missing.webp'},
                 {'quarantined':True,'reason':'fixture quarantine'}))
elif scenario!='ordinary':
    raise SystemExit('Unknown fixture media scenario')
def copy_value(value):
    if value is None: return r'\N'
    if not isinstance(value,str): value=json.dumps(value,separators=(',',':'))
    return value.replace('\\','\\\\').replace('\t',r'\t').replace('\n',r'\n').replace('\r',r'\r')
text='COPY public.media (id, storage_key, renditions_json, normalize_json) FROM stdin;\n'
text+=''.join('\t'.join(copy_value(v) for v in row)+'\n' for row in rows)
pathlib.Path(sys.argv[1]).write_text(text+'\\.\n')
PY
}
run_export() {
  export FIXTURE_RUN_ID=$2
  bash "$exporter" "$@"
}
expect_failure() {
  label=$1
  shift
  if run_export "$@" > "$temp/$label.stdout" 2> "$temp/$label.stderr"; then
    fail "$label unexpectedly succeeded"
  fi
}
assert_absent_run() {
  [[ $1 =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{32}$ ]] || fail 'Unsafe fixture assertion ID'
  [[ ! -e $out/$1 && ! -L $out/$1 ]] || fail "Partial run remains: $1"
}
age-keygen -o "$temp/identity.txt" 2> "$temp/keygen.log"
recipient=$(age-keygen -y "$temp/identity.txt")
age-keygen -o "$temp/wrong-identity.txt" 2> "$temp/wrong-keygen.log"
older=$(id 1)
mkdir -m 700 "$out/$older"
printf 'preserve older backup\n' > "$out/$older/keep"
make_rows ordinary
success=$(id 2)
run_export create "$success" "$recipient" > "$temp/success.json" 2> "$temp/success.log"
archive=$out/$success/namilux-backup.tar.gz.age
[[ -f $archive && ! -e $out/$success/work && ! -e $temp/env-was-executed ]] || fail 'Successful run leaked work or executed .env'
[[ $(stat -c %a "$out/$success") == 700 && $(stat -c %a "$archive") == 600 ]] || fail 'Unsafe output permissions'
python3 - "$temp/success.json" "$archive" "$success" "$release" <<'PY'
import hashlib,json,pathlib,sys
meta=json.loads(pathlib.Path(sys.argv[1]).read_text()); archive=pathlib.Path(sys.argv[2])
assert meta['runId']==sys.argv[3] and meta['path']==str(archive) and meta['release']==sys.argv[4]
assert meta['bytes']==archive.stat().st_size and meta['bytes']>0
assert meta['sha256']==hashlib.sha256(archive.read_bytes()).hexdigest()
PY
age --decrypt -i "$temp/identity.txt" -o "$temp/bundle.tar.gz" "$archive"
mkdir -m 700 "$temp/decrypted"
tar -xzf "$temp/bundle.tar.gz" -C "$temp/decrypted"
(cd "$temp/decrypted" && sha256sum --check CHECKSUMS.sha256 > "$temp/checksums.log")
python3 - "$temp/decrypted" "$root" "$etc_dir" "$release" "$success" <<'PY'
import json,pathlib,sys,tarfile
w,root,etc,release=map(pathlib.Path,sys.argv[1:5])
assert (w/'database.dump').read_text()=='FIXTURE-DATABASE-DUMP\n'
assert 'fixture pg_restore' in (w/'database.contents').read_text()
assert json.loads((w/'database-roles.json').read_text())[0]['rolname']=='nl_web'
m=json.loads((w/'manifest.json').read_text())
assert m['format']==1 and m['runId']==sys.argv[5] and m['release']==str(release)
assert m['onlineBackup'] is True and m['buildOutputsIncluded'] is False
assert 'not a full restore drill' in m['databaseDumpChecked']
assert 'isolated' in (w/'RECOVERY.txt').read_text()
v=json.loads((w/'media-validation.json').read_text())
assert v['allRequiredFilesPresent'] is True and v['rows']==2 and v['referencedKeys']==4
assert v['rejectedUploadTombstonesWithoutOriginal']==0
for dest,source in [
    ('config/namilux.env',root/'.env'),('config/server-bin/release.sh',root/'bin/release.sh'),
    ('config/caddy/Caddyfile',etc/'caddy/Caddyfile'),
    ('config/postgresql/16/main/postgresql.conf',etc/'postgresql/16/main/postgresql.conf'),
    ('config/systemd/namilux-web.service',etc/'systemd/system/namilux-web.service'),
    ('config/systemd/namilux-backup.timer',etc/'systemd/system/namilux-backup.timer'),
    ('config/systemd/namilux-worker.service.d/override.conf',etc/'systemd/system/namilux-worker.service.d/override.conf'),
    ('config/systemd/caddy.service',etc/'systemd/system/caddy.service'),
    ('config/systemd/caddy.service.d/override.conf',etc/'systemd/system/caddy.service.d/override.conf'),
    ('config/systemd-control/caddy.service.d/50-MemoryMax.conf',etc/'systemd/system.control/caddy.service.d/50-MemoryMax.conf'),
]:
    assert (w/dest).read_bytes()==source.read_bytes(),dest
with tarfile.open(w/'media.tar.gz') as t:
    for key in ['images/original.jpg','images/small.webp','images/large.webp','media/logo.jpg']:
        assert t.extractfile('./'+key).read()==(root/'media'/key).read_bytes()
with tarfile.open(w/'release-source.tar.gz') as t:
    names={str(pathlib.PurePosixPath(n)) for n in t.getnames()}
    assert 'package.json' in names and 'apps/web/src/page.ts' in names
    for name in names:
        parts=pathlib.PurePosixPath(name).parts
        assert not any(p in ('node_modules','.git','.codex','.unit-backup','KEYS') or p.startswith(('.next','.env')) for p in parts),name
        assert not name.endswith('.log'),name
    assert t.extractfile('./apps/web/src/page.ts').read()==(release/'apps/web/src/page.ts').read_bytes()
checks=(w/'CHECKSUMS.sha256').read_text().splitlines()
listed={line.split('  ',1)[1] for line in checks}
actual={str(p.relative_to(w)) for p in w.rglob('*') if p.is_file() and not p.is_symlink() and p.name!='CHECKSUMS.sha256'}
assert listed==actual
PY
pass 'real encrypted round trip, outer digest, internal checksums, manifest, DB/media/source/config and exclusions'
if age --decrypt -i "$temp/wrong-identity.txt" -o "$temp/wrong.tar.gz" "$archive" 2> "$temp/wrong-key.log"; then
  fail 'Wrong private key decrypted the archive'
fi
pass 'wrong age identity cannot decrypt'

bad=$(id 3)
expect_failure bad-recipient create "$bad" not-an-age-recipient
assert_absent_run "$bad"
bad_checksum=age1$(printf '%060d' 0)
expect_failure bad-recipient-checksum create "$bad" "$bad_checksum"
assert_absent_run "$bad"
pass 'bad recipient format and checksum rejected without leftover runs'
dump_fail=$(id 4)
export FAIL_DUMP=1
expect_failure dump-failure create "$dump_fail" "$recipient"
export FAIL_DUMP=0
assert_absent_run "$dump_fail"
grep -q 'Injected pg_dump failure' "$temp/dump-failure.stderr"
[[ -f $archive && -f $out/$older/keep ]] || fail 'Dump failure touched another run'
pass 'failed pg_dump removes its partial run and preserves older backups'

missing=$(id 5)
mv "$media/images/original.jpg" "$temp/original.saved"
expect_failure missing-media create "$missing" "$recipient"
mv "$temp/original.saved" "$media/images/original.jpg"
assert_absent_run "$missing"
grep -q 'missing from the archive' "$temp/missing-media.stderr"
pass 'missing DB-referenced original fails coverage'
make_rows tombstone
tombstone=$(id 6)
run_export create "$tombstone" "$recipient" > "$temp/tombstone.json" 2> "$temp/tombstone.log"
age --decrypt -i "$temp/identity.txt" -o "$temp/tombstone.tar.gz" "$out/$tombstone/namilux-backup.tar.gz.age"
python3 - "$temp/tombstone.tar.gz" <<'PY'
import json,sys,tarfile
with tarfile.open(sys.argv[1]) as t:
    v=json.load(t.extractfile('./media-validation.json'))
    assert v['rows']==3 and v['allRequiredFilesPresent'] is True
    assert v['rejectedUploadTombstonesWithoutOriginal']==1
PY
pass 'rejected tmp upload with quarantine reason may lack its deleted original'
make_rows tombstone-no-reason
no_reason=$(id 7)
expect_failure tombstone-no-reason create "$no_reason" "$recipient"
assert_absent_run "$no_reason"
pass 'missing tmp original without a quarantine reason is not exempt'
make_rows quarantined-rendition
quarantined=$(id 8)
expect_failure quarantined-rendition create "$quarantined" "$recipient"
assert_absent_run "$quarantined"
grep -q 'missing from the archive' "$temp/quarantined-rendition.stderr"
pass 'quarantine does not exempt a missing normal rendition'
make_rows ordinary

expect_failure unsafe-run create "../$older" "$recipient"
expect_failure unsafe-cleanup cleanup ".." ""
unsafe=$(id 9)
NAMILUX_BACKUP_ROOT=/ expect_failure unsafe-root create "$unsafe" "$recipient"
NAMILUX_BACKUP_OUT=relative-output expect_failure unsafe-output create "$unsafe" "$recipient"
ln -s "$out" "$temp/output-link"
NAMILUX_BACKUP_OUT=$temp/output-link expect_failure symlink-output create "$unsafe" "$recipient"
ln -s "$out/$older" "$out/$unsafe"
expect_failure symlink-cleanup cleanup "$unsafe" ""
[[ -f $out/$older/keep && -L $out/$unsafe ]] || fail 'Unsafe cleanup followed a symlink'
rm -- "$out/$unsafe"
pass 'unsafe IDs, configured paths and symlink cleanup are rejected'
overlap=$(id 10)
exec 8>"$out/.export.lock"
flock -n 8
expect_failure overlap create "$overlap" "$recipient"
expect_failure overlap-cleanup cleanup "$tombstone" ""
[[ -f $out/$tombstone/namilux-backup.tar.gz.age ]] || fail 'Cleanup bypassed the export lock'
flock -u 8
exec 8>&-
assert_absent_run "$overlap"
grep -q 'Another customer backup is running' "$temp/overlap.stderr"
grep -q 'Another customer backup is running' "$temp/overlap-cleanup.stderr"
pass 'overlapping export and cleanup are rejected by the real flock lock'

run_export cleanup "$success" "" > "$temp/cleanup.json"
assert_absent_run "$success"
[[ -f $out/$older/keep && -f $out/$tombstone/namilux-backup.tar.gz.age ]] || fail 'Cleanup removed another run'
python3 - "$temp/cleanup.json" <<'PY'
import json,pathlib,sys
assert json.loads(pathlib.Path(sys.argv[1]).read_text())=={'cleaned':True}
PY
run_export cleanup "$success" "" > "$temp/cleanup-again.json"
[[ -f $out/$older/keep ]] || fail 'Repeated cleanup touched older data'
pass 'cleanup is idempotent and removes only the named run'
mv "$etc_dir/systemd/system.control/caddy.service.d" "$temp/saved-caddy-control"
without_caddy=$(id 11)
run_export create "$without_caddy" "$recipient" > "$temp/no-caddy-control.json"
[[ -f $out/$without_caddy/namilux-backup.tar.gz.age ]] || fail 'Optional absent Caddy control override broke export'
run_export cleanup "$without_caddy" "" > /dev/null
pass 'optional absent Caddy control override does not break export'
[[ ! -s $FIXTURE_UNEXPECTED ]] || fail 'Exporter attempted an unexpected database/sudo/version command'
for tool in sudo pg_dump pg_restore psql; do
  grep -qx "$tool" "$FIXTURE_CALLS" || fail "Expected stub was not exercised: $tool"
done
printf 'Customer export fixtures passed: %s scenarios; no real DB, services, network or customer data used.\n' "$passes"
