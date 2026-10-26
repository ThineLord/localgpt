"""Bounded source-only CI; never launch the application against user data."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()


def manifest():
    return {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
            for name in git('ls-files').splitlines()}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--expected-sha', required=True)
    args = parser.parse_args()
    sha = git('rev-parse', 'HEAD')
    if sha != args.expected_sha or git('status', '--porcelain'):
        raise SystemExit('CI requires the exact committed SHA and a clean source tree')
    # Index privacy gate also rejects tracked database files, symlinks and gitlinks.
    subprocess.run([sys.executable, 'tools/audit_source.py'], cwd=ROOT, check=True, timeout=60)
    before = manifest()
    print('CI_SOURCE_SHA ' + sha, flush=True)
    with tempfile.TemporaryDirectory(prefix='localgpt-ci-') as temporary:
        root = Path(temporary).resolve()
        for name in ('home', 'tmp', 'receipts'):
            (root / name).mkdir()
        env = {
            'PATH': os.pathsep.join((str(Path(sys.executable).parent), str(Path(shutil.which('git')).parent), os.defpath)),
            'HOME': str(root / 'home'), 'TMPDIR': str(root / 'tmp'),
            'TMP': str(root / 'tmp'), 'TEMP': str(root / 'tmp'),
            'XDG_CONFIG_HOME': str(root / 'home'), 'PYTHONNOUSERSITE': '1',
            'PYTHONDONTWRITEBYTECODE': '1', 'PYTHONUNBUFFERED': '1',
            'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': os.devnull,
            'LOCALGPT_CI_ROOT': str(root), 'APP03_RECEIPTS': str(root / 'receipts'),
        }
        commands = [
            ['work/chat-sidebar/build.py'],
            ['work/chat-sidebar/build.py', '--check'],
            ['tools/ci_guard.py', 'backend'],
            ['tools/ci_guard.py', 'tools'],
        ]
        for command in commands:
            subprocess.run([sys.executable, '-B', *command], cwd=ROOT, env=env,
                           check=True, timeout=300)
        receipts = [json.loads(path.read_text()) for path in (root / 'receipts').glob('*.json')]
        if len(receipts) != 13 or any(r['sqlite_integrity'] != 'ok' for r in receipts):
            raise SystemExit('Incomplete APP-03 HTTP/SQLite acceptance receipts')
        workers = [worker for receipt in receipts for worker in receipt['workers']]
        for worker in workers:
            guards = [worker[k] for k in ('guard', 'guard_before_sigkill') if k in worker]
            if not guards or any(g['denied'] for g in guards) or worker['exit_code'] not in (0, -9):
                raise SystemExit('Invalid fixture isolation or worker cleanup receipt')
        print('CI_APP03 ' + json.dumps({'cases': len(receipts), 'workers_reaped': len(workers),
              'sigkill_exits': sum(w['exit_code'] == -9 for w in workers),
              'guard_denials': 0, 'sqlite_integrity': 'ok'}), flush=True)
    if manifest() != before or git('status', '--porcelain'):
        raise SystemExit('CI changed tracked source/tests or left untracked files')
    subprocess.run(['git', 'diff', '--check', 'HEAD^', 'HEAD'], cwd=ROOT, check=True, timeout=30)
    print('CI_LOCAL_PASS ' + sha, flush=True)


if __name__ == '__main__':
    main()
