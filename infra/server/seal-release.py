#!/usr/bin/env python3
"""Protect deployment code; only Next runtime caches may remain app-writable."""
import os
import pwd
import stat
import sys
from pathlib import Path

root = Path('/opt/namilux/releases')
release = Path(sys.argv[1]) if len(sys.argv) == 2 else Path('/')
if os.geteuid() != 0 or release.is_symlink() or release.parent != root or not release.is_dir():
    raise SystemExit('Expected root and one real release directly under /opt/namilux/releases')
if root.is_symlink() or root.stat().st_uid != 0 or root.stat().st_mode & 0o022:
    raise SystemExit('Release parent must be root-controlled')
gid = pwd.getpwnam('namilux').pw_gid

# Validate all paths before changing ownership; an invalid dependency must not leave a half-sealed tree.
paths = [release]
for directory, dirs, files in os.walk(release, followlinks=False):
    paths.extend(Path(directory) / name for name in dirs + files)
for path in paths:
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode):
        if not path.resolve().is_relative_to(release):
            raise SystemExit('Release symlink escapes protected release: ' + str(path.relative_to(release)))
    elif not (stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode)):
        raise SystemExit('Unexpected special file in release')

def protect(path):
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode) and not path.resolve().is_relative_to(release):
        raise SystemExit('Release symlink escapes protected release')
    os.chown(path, 0, gid, follow_symlinks=False)
    if stat.S_ISLNK(info.st_mode):
        return
    if not (stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode)):
        raise SystemExit('Unexpected special file in release')
    private = path.name.startswith('.env') or path.name == 'KEYS'
    mode = (0o700 if info.st_mode & 0o111 else 0o600) if private else (0o750 if info.st_mode & 0o111 else 0o640)
    os.chmod(path, mode)

protect(release)
for directory, dirs, files in os.walk(release, followlinks=False):
    for name in dirs + files:
        protect(Path(directory) / name)

for app in ('web', 'admin'):
    for output in (release / 'apps' / app / '.next', release / 'apps' / app / '.next/standalone/apps' / app / '.next'):
        if not output.exists():
            continue
        # Next writes image/fetch caches and regenerated HTML/RSC beside its prerendered app routes.
        # Deployment scripts/config/dependencies are outside these runtime-write exceptions.
        for suffix in ('cache', 'server/app', 'server/pages'):
            cache = output / suffix
            cache.mkdir(parents=True, exist_ok=True)
            if cache.resolve() != cache or release not in cache.parents:
                raise SystemExit('Runtime cache path must not traverse a symlink')
            for directory, dirs, files in os.walk(cache, followlinks=False):
                if any((Path(directory) / name).is_symlink() for name in dirs):
                    raise SystemExit('Unexpected runtime cache directory symlink')
                for path in [Path(directory)] + [Path(directory) / name for name in files]:
                    if path.is_symlink():
                        raise SystemExit('Unexpected runtime cache symlink')
                    os.chown(path, 0, gid)
                    os.chmod(path, 0o770 if path.is_dir() else 0o660)
print('Sealed release: ' + release.name)
