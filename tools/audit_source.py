"""Review staged source or all reachable history without ever printing secret matches."""
import argparse
import re
import subprocess
import sys
from pathlib import PurePosixPath

def git(*args):
    return subprocess.check_output(['git', *args])

rules = {
    'credential': rb'(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{24,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY)',
    'secret_assignment': rb'(?i)(?:api_key|password|access_token|client_secret)\s*[:=]\s*[\"\x27][^\"\x27\s]{8,}[\"\x27]',
    'personal_home': rb'/' + rb'Users/[^/\s]+/',
}
parser = argparse.ArgumentParser()
parser.add_argument('--history', action='store_true', help='Scan every reachable commit and unique source blob')
args = parser.parse_args()
entries = []
if args.history:
    commits = git('rev-list', '--all').decode().splitlines()
    for commit in commits:
        for item in git('ls-tree', '-rz', '--full-tree', commit).split(b'\0'):
            if not item:
                continue
            meta, path = item.split(b'\t', 1)
            mode, kind, oid = meta.decode().split()
            entries.append((path.decode(), oid, kind, mode))
else:
    paths = git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z').decode().split('\0')
    entries = [(name, ':' + name, 'blob', '100644') for name in paths if name]

failures = set()
seen = set()
for name, oid, kind, mode in entries:
    if (name, oid) in seen:
        continue
    seen.add((name, oid))
    p = PurePosixPath(name)
    if kind != 'blob' or mode in ('120000', '160000'):
        failures.add((name, 'symlink/submodule is not approved source'))
        continue
    if p.suffix not in ('.py', '.js', '.cjs', '.css', '.html', '.md', '.txt', '.yml', '.yaml', '.example') and name != '.gitignore':
        failures.add((name, 'not approved source format'))
        continue
    if any(x in p.parts for x in ('output', 'outputs', 'data', 'backups', 'logs', '.playwright-cli')):
        failures.add((name, 'runtime directory'))
    data = git('show', oid)
    for rule, pattern in rules.items():
        if re.search(pattern, data):
            failures.add((name, rule))
print('Reviewed unique path/blob pairs:', len(seen))
if args.history:
    print('Reachable commits:', len(commits))
for name, rule in sorted(failures):
    print(name, rule)
if failures:
    sys.exit(1)
print('Source format and credential checks passed. Human privacy review is still required.')
