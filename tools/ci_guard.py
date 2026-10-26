"""Run synthetic unittest suites with database/network guardrails.

This is defense in depth for reviewed tests, not a sandbox for hostile Python.
APP-03 HTTP children also install their own stricter per-fixture guard.
"""
import os
from pathlib import Path
import sqlite3
import sys
import unittest
from urllib.parse import unquote, urlparse


def install_guard(root):
    root = Path(root).resolve(strict=True)

    def within(value):
        value = os.fsdecode(value)
        if value.startswith('file:'):
            value = unquote(urlparse(value).path)
        path = Path(value).resolve()
        return path == root or root in path.parents

    def audit(event, args):
        if event == 'sqlite3.connect':
            if args[0] != ':memory:' and not within(args[0]):
                raise PermissionError('CI SQLite must be synthetic and inside the temporary root')
        elif event == 'open' and not isinstance(args[0], int):
            name = os.fsdecode(args[0])
            if (name.endswith(('.db', '.sqlite', '.sqlite3', '-wal', '-shm'))
                    or Path(name).name == '.env') and not within(name):
                raise PermissionError('CI cannot read external database or secret files')
        elif event in ('socket.connect', 'socket.bind'):
            address = args[1]
            if not isinstance(address, tuple):
                raise PermissionError('CI forbids non-IP network access')
            host, port = address[:2]
            if host not in ('127.0.0.1', '::1') or port in (1234, 8188, 8190):
                raise PermissionError('CI permits synthetic loopback services only')
            if event == 'socket.bind' and port != 0:
                raise PermissionError('CI listeners must use ephemeral ports')
        elif event == 'subprocess.Popen':
            executable = Path(os.fsdecode(args[0]))
            if executable.name != 'git' and executable.resolve() != Path(sys.executable).resolve():
                raise PermissionError('CI forbids model CLIs and unrelated subprocesses')
        elif event == 'os.system':
            raise PermissionError('CI forbids shell commands')

    sys.addaudithook(audit)


def main():
    root = os.environ['LOCALGPT_CI_ROOT']
    install_guard(root)
    suite_name = sys.argv[1]
    directory, minimum = {'backend': ('work/chat-sidebar', 176), 'tools': ('tools', 10)}[suite_name]
    suite = unittest.TestLoader().discover(directory, pattern='test_*.py')
    count = suite.countTestCases()
    if count < minimum:
        raise SystemExit(f'Test discovery shrank: {count} < {minimum}')
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if not result.wasSuccessful() or result.skipped or result.expectedFailures:
        raise SystemExit(1)
    print(f'CI_SUITE {suite_name}: {count} passed; no skips or expected failures', flush=True)


if __name__ == '__main__':
    main()
