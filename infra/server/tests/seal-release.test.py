#!/usr/bin/env python3
import os
import subprocess
import tempfile
from pathlib import Path

source = (Path(__file__).resolve().parents[1] / 'seal-release.py').read_text()
with tempfile.TemporaryDirectory(prefix='namilux-seal-fixture-') as temporary:
    base = Path(temporary)
    base.chmod(0o755)
    releases = base / 'releases'
    releases.mkdir(mode=0o755)
    release = releases / 'fixture'
    release.mkdir()
    for name in ('infra/server', 'packages/config/src', 'node_modules', 'apps/web/.next/standalone/apps/web/.next/server/app'):
        (release / name).mkdir(parents=True, exist_ok=True)
    code = release / 'packages/config/src/env.ts'
    code.write_text('fixture')
    cache = release / 'apps/web/.next/standalone/apps/web/.next/server/app'
    (cache / 'index.html').write_text('fixture')
    script = base / 'seal.py'
    script.write_text(source.replace("Path('/opt/namilux/releases')", 'Path(' + repr(str(releases)) + ')'))
    subprocess.run(['python3', str(script), str(release)], check=True)
    for path in (release, code, release / 'infra/server', release / 'node_modules'):
        assert subprocess.run(['sudo', '-u', 'namilux', 'test', '-w', str(path)]).returncode != 0
    assert subprocess.run(['sudo', '-u', 'namilux', 'test', '-r', str(code)]).returncode == 0
    assert subprocess.run(['sudo', '-u', 'namilux', 'test', '-w', str(cache)]).returncode == 0
    assert subprocess.run(['sudo', '-u', 'namilux', 'test', '-w', str(cache / 'index.html')]).returncode == 0
    (release / 'escape').symlink_to('/etc/passwd')
    assert subprocess.run(['python3', str(script), str(release)], capture_output=True).returncode != 0
    (release / 'escape').unlink()
    alias = releases / 'alias'
    alias.symlink_to(release)
    assert subprocess.run(['python3', str(script), str(alias)], capture_output=True).returncode != 0
    assert subprocess.run(['python3', str(script), str(base)], capture_output=True).returncode != 0
print('PASS: protected code/dependencies, readable runtime, writable caches, and path/symlink rejection')
