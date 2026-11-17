#!/usr/bin/env bash
# Invoked over SSH by Backup-Namilux.ps1. Reads live data; never restores or restarts services.
set -euo pipefail
umask 077
action=${1:-}
run_id=${2:-}
recipient=${3:-}
[[ $EUID == 0 ]] || { echo 'Run through the authorized root SSH account.' >&2; exit 2; }
[[ $run_id =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{32}$ ]] || { echo 'Invalid backup ID.' >&2; exit 2; }
[[ $action == create || $action == cleanup ]] || { echo 'Expected create or cleanup.' >&2; exit 2; }
# Overrides are for isolated fixture tests or an operator-reviewed relocation, not customer inputs.
root=${NAMILUX_BACKUP_ROOT:-/opt/namilux}
base=${NAMILUX_BACKUP_OUT:-/var/backups/namilux-customer}
etc_dir=${NAMILUX_BACKUP_ETC:-/etc}
for p in "$root" "$base" "$etc_dir"; do
  [[ $p == /* && $p != / && $p != *$'\n'* ]] || { echo 'Invalid configured path.' >&2; exit 2; }
done
python3 - "$base" <<'PY'
import pathlib,stat,sys
base=pathlib.Path(sys.argv[1])
for parent in base.parents:
    mode=parent.lstat()
    if stat.S_ISLNK(mode.st_mode) or mode.st_uid!=0 or (mode.st_mode&0o022 and not mode.st_mode&stat.S_ISVTX):
        raise SystemExit('Export directory ancestors must be root-controlled.')
PY
[[ ! -L $base ]] || { echo 'Export directory must not be a symlink.' >&2; exit 2; }
if [[ ! -e $base ]]; then mkdir -m 700 -- "$base"; fi
[[ -d $base && $(stat -c %u "$base") == 0 && $(stat -c %a "$base") == 700 ]] || {
  echo 'Export directory must be root-owned mode 0700.' >&2; exit 2;
}
base=$(realpath -e "$base")
run_dir=$base/$run_id
exec 9>"$base/.export.lock"
flock -n 9 || { echo 'Another customer backup is running; try later.' >&2; exit 2; }
if [[ $action == cleanup ]]; then
  [[ ! -L $run_dir ]] || { echo 'Refusing symlink cleanup.' >&2; exit 2; }
  if [[ -d $run_dir ]]; then rm -rf -- "$run_dir"; fi
  printf '{"cleaned":true}\n'
  exit 0
fi
[[ $recipient =~ ^age1[0-9a-z]{50,120}$ ]] || { echo 'Use a standard age public recipient.' >&2; exit 2; }
for command in age pg_dump pg_restore psql sudo tar gzip sha256sum flock python3 realpath; do
  command -v "$command" >/dev/null || { echo "Missing required program: $command" >&2; exit 2; }
done
[[ ! -e $run_dir && ! -L $run_dir ]] || { echo 'Backup ID already exists.' >&2; exit 2; }
mkdir -m 700 -- "$run_dir"
work=$run_dir/work
mkdir -m 700 -- "$work"
complete=0
cleanup() {
  result=$?
  trap - EXIT
  # Both paths are generated under the verified private directory; no caller-supplied deletion path.
  if [[ $complete == 1 ]]; then rm -rf -- "$work"; else rm -rf -- "$run_dir"; fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
age --encrypt -r "$recipient" -o "$work/recipient-check.age" /dev/null
rm -- "$work/recipient-check.age"

release=$(realpath -e "$root/current")
releases=$(realpath -e "$root/releases")
[[ $release == "$releases/"* && -f $release/package.json && -f $root/.env ]] || {
  echo 'Current Namilux release or environment is missing.' >&2; exit 2;
}
start=$(date -u +%FT%TZ)
# Parse only the media path as data. Never source .env or run code from the app-writable release.
media=$(python3 - "$root" <<'PY'
import pathlib,re,sys
root=pathlib.Path(sys.argv[1]); media=str(root/'media')
for line in (root/'.env').read_text().splitlines():
    if line.startswith('MEDIA_DIR='):
        media=line.split('=',1)[1].strip().strip('"').strip("'")
if not re.fullmatch(r'/[A-Za-z0-9_./-]+',media): raise SystemExit('Unsupported MEDIA_DIR; ask the operator to review it.')
p=pathlib.Path(media).resolve(strict=True)
if not p.is_dir() or not p.is_relative_to(root.resolve()) or p==root.resolve():
    raise SystemExit('Expected a media directory inside the Namilux installation.')
print(p)
PY
)
db_bytes=$(sudo -u postgres psql -X -q -t -A -v ON_ERROR_STOP=1 -d namilux -c "SELECT pg_database_size(current_database())")
[[ $db_bytes =~ ^[0-9]+$ ]] || { echo 'Could not estimate database size.' >&2; exit 1; }
python3 - "$base" "$media" "$release" "$db_bytes" <<'PY'
import os,pathlib,shutil,sys
def size(path,source=False):
    total=0
    for parent,dirs,files in os.walk(path,followlinks=False):
        dirs[:]=[d for d in dirs if not (source and (d in ('node_modules','.git','.codex','.unit-backup','KEYS') or d.startswith('.next')))]
        for name in files:
            p=pathlib.Path(parent)/name
            if p.is_file() and not p.is_symlink(): total+=p.stat().st_size
    return total
needed=2*(int(sys.argv[4])+size(sys.argv[2])+size(sys.argv[3],True))+512*1024**2
if shutil.disk_usage(sys.argv[1]).free<needed: raise SystemExit('Insufficient free disk space for a safe export.')
PY
echo 'Creating fresh database and media backup; website remains running.' >&2
sudo -u postgres pg_dump -Fc --no-owner --lock-wait-timeout=15s namilux > "$work/database.dump"
pg_restore --list "$work/database.dump" > "$work/database.contents"
pg_restore --data-only --table=media --file="$work/media-rows.sql" "$work/database.dump"
tar -czf "$work/media.tar.gz" -C "$media" .
# Confirm that media referenced by THIS dump is included; a concurrent deletion must fail the export.
python3 - "$work" <<'PY'
import json,pathlib,re,sys,tarfile
w=pathlib.Path(sys.argv[1])
with tarfile.open(w/'media.tar.gz','r:gz') as archive:
    names=set()
    for item in archive:
        path=pathlib.PurePosixPath(item.name)
        if path.is_absolute() or '..' in path.parts or not (item.isfile() or item.isdir()):
            raise SystemExit('Unsafe media archive entry; ask the operator to inspect media.')
        if item.isfile(): names.add(str(path))
def unescape(value):
    escapes={'b':'\b','f':'\f','n':'\n','r':'\r','t':'\t','v':'\v','\\':'\\'}
    def repl(match):
        char=match.group(1)
        if re.fullmatch('[0-7]{1,3}',char): return chr(int(char,8))
        if char.startswith('x') and len(char)>1: return chr(int(char[1:],16))
        return escapes.get(char,char)
    return re.sub(r'\\([0-7]{1,3}|x[0-9A-Fa-f]{1,2}|.)',repl,value)
def leaves(value):
    if isinstance(value,str): yield value
    elif isinstance(value,dict):
        for v in value.values(): yield from leaves(v)
    elif isinstance(value,list):
        for v in value: yield from leaves(v)
copy=False; found=False; keys=set(); rows=0; rejected_missing=0
for line in (w/'media-rows.sql').read_text().splitlines():
    if line.startswith('COPY public.media (') and line.endswith(' FROM stdin;'):
        columns=line[len('COPY public.media ('):].split(') FROM stdin;',1)[0].split(', ')
        key_index=columns.index('storage_key'); rendition_index=columns.index('renditions_json'); normalize_index=columns.index('normalize_json')
        found=True; copy=True; continue
    if line=='\\.': copy=False; continue
    if not copy: continue
    fields=line.split('\t'); rows+=1
    key=unescape(fields[key_index])
    renditions=None if fields[rendition_index]=='\\N' else json.loads(unescape(fields[rendition_index]))
    normalize=None if fields[normalize_index]=='\\N' else json.loads(unescape(fields[normalize_index]))
    # Rejected upload tombstones deliberately retain a DB row after the worker deletes temp bytes.
    # Keep ordinary quarantined image renditions subject to the normal coverage check.
    if (key.startswith('tmp/') and not renditions and isinstance(normalize,dict)
        and normalize.get('quarantined') is True and isinstance(normalize.get('reason'),str)
        and normalize['reason'] and key not in names):
        rejected_missing+=1; continue
    keys.add(key)
    if renditions is not None: keys.update(leaves(renditions))
if not found: raise SystemExit('Media COPY data missing from dump; cannot certify media coverage.')
for key in keys:
    if key.startswith(('http://','https://','data:')):
        raise SystemExit('Externally stored media needs an operator-reviewed backup policy.')
    if str(pathlib.PurePosixPath(key)) not in names:
        raise SystemExit('Media referenced by the database dump is missing from the archive; retry after catalog edits finish.')
(w/'media-validation.json').write_text(json.dumps({'rows':rows,'referencedKeys':len(keys),'archiveFiles':len(names),'allRequiredFilesPresent':True,'rejectedUploadTombstonesWithoutOriginal':rejected_missing},indent=2)+'\n')
PY
rm -- "$work/media-rows.sql"
mkdir -m 700 "$work/config"
cp -- "$root/.env" "$work/config/namilux.env"
cp -a -- "$root/bin" "$work/config/server-bin"
for name in caddy postgresql; do
  [[ ! -d $etc_dir/$name ]] || cp -a -- "$etc_dir/$name" "$work/config/$name"
done
mkdir "$work/config/systemd"
shopt -s nullglob
units=("$etc_dir"/systemd/system/namilux-*.service "$etc_dir"/systemd/system/namilux-*.timer "$etc_dir"/systemd/system/namilux-*.service.d "$etc_dir"/systemd/system/namilux-*.timer.d)
if ((${#units[@]})); then cp -a -- "${units[@]}" "$work/config/systemd/"; fi
for path in "$etc_dir/systemd/system/caddy.service" "$etc_dir/systemd/system/caddy.service.d"; do
  [[ ! -e $path ]] || cp -a -- "$path" "$work/config/systemd/"
done
mkdir "$work/config/systemd-control"
overrides=("$etc_dir"/systemd/system.control/namilux-*.service.d)
[[ ! -e $etc_dir/systemd/system.control/caddy.service.d ]] || overrides+=("$etc_dir/systemd/system.control/caddy.service.d")
if ((${#overrides[@]})); then cp -a -- "${overrides[@]}" "$work/config/systemd-control/"; fi
tar -czf "$work/release-source.tar.gz" --exclude=node_modules --exclude='.next*' --exclude=.git --exclude=.codex --exclude=.unit-backup --exclude='.env*' --exclude=KEYS --exclude='*.log' -C "$release" .
[[ $(realpath -e "$root/current") == "$release" ]] || { echo 'A release changed during export; retry after deployment.' >&2; exit 1; }
cmp -s -- "$root/.env" "$work/config/namilux.env" || { echo 'Environment changed during export; retry.' >&2; exit 1; }
sudo -u postgres psql -X -q -t -A -v ON_ERROR_STOP=1 -d namilux -c "BEGIN READ ONLY; SELECT coalesce(json_agg(r),'[]'::json) FROM (SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname IN ('nl_migrate','nl_web','nl_admin','nl_worker') ORDER BY rolname)r; COMMIT;" > "$work/database-roles.json"
python3 - "$work" "$release" "$start" "$run_id" <<'PY'
import datetime,json,pathlib,subprocess,sys
w=pathlib.Path(sys.argv[1])
versions={}
for name,args in [('postgresql',['pg_dump','--version']),('node',['node','--version']),('pnpm',['pnpm','--version'])]:
    result=subprocess.run(args,capture_output=True,text=True,timeout=20)
    versions[name]=result.stdout.strip() if result.returncode==0 else 'unavailable'
manifest={'format':1,'runId':sys.argv[4],'startedAt':sys.argv[3],'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'release':sys.argv[2],'versions':versions,'database':'namilux','onlineBackup':True,'buildOutputsIncluded':False,'databaseDumpChecked':'pg_restore --list; not a full restore drill','mediaCoverage':'referenced files from this dump checked against media archive','roles':'recreate using trusted provisioning and packages/db/roles.sql; credentials are in encrypted config'}
(w/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
PY
cat > "$work/RECOVERY.txt" <<'TXT'
This bundle is encrypted customer backup data, not an executable server image.
Keep the age private key outside the server and keep another offline copy.
Decrypt into a private directory, inspect the archives, verify CHECKSUMS.sha256.
Never restore over the live shop as a test. Use an isolated new server/database.
Provision trusted code with compatible PostgreSQL/Node/pnpm; preserve signing and
provider secrets, recreate application roles, and reconcile DB credentials.
Restore database.dump with pg_restore --exit-on-error --no-owner --no-acl into the
isolated database under the intended owner, then reapply reviewed role grants.
Restore media.tar.gz into the separate host's media directory and verify references.
Release source excludes node_modules and .next; install and rebuild from trusted source.
Keep payment, SMS, notifications and worker schedules disabled during the drill.
Config/media were captured online, not by an atomic whole-server snapshot.
Archive parsing and checksums do not replace a full isolated restore test.
TXT
python3 - "$work" <<'PY'
import hashlib,pathlib,sys
w=pathlib.Path(sys.argv[1]); lines=[]
for p in sorted(w.rglob('*')):
    # A symlink is archived as a link; never hash a target outside the staged bundle.
    if not p.is_file() or p.is_symlink(): continue
    with p.open('rb') as source: digest=hashlib.file_digest(source,'sha256').hexdigest()
    lines.append(digest+'  '+str(p.relative_to(w)))
(w/'CHECKSUMS.sha256').write_text('\n'.join(lines)+'\n')
PY
file=$run_dir/namilux-backup.tar.gz.age
tar -czf - -C "$work" . | age --encrypt -r "$recipient" -o "$file.partial"
mv -- "$file.partial" "$file"
sha=$(sha256sum "$file"); sha=${sha%% *}
bytes=$(stat -c %s "$file")
complete=1
python3 - "$run_id" "$file" "$sha" "$bytes" "$release" <<'PY'
import json,sys
print(json.dumps({'runId':sys.argv[1],'path':sys.argv[2],'sha256':sys.argv[3],'bytes':int(sys.argv[4]),'release':sys.argv[5]}))
PY
