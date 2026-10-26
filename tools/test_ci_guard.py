"""Negative checks: reject unsafe paths/network before attempting any IO."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

GUARD = Path(__file__).with_name('ci_guard.py')


class CIGuardTests(unittest.TestCase):
    def check_probe(self, probe):
        with tempfile.TemporaryDirectory() as root:
            code = "import sys,runpy; m=runpy.run_path(sys.argv[1]); m['install_guard'](sys.argv[2]); " + probe
            result = subprocess.run([sys.executable, '-B', '-c', code, str(GUARD), root],
                                    capture_output=True, text=True, timeout=10)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('PermissionError', result.stderr)

    def test_external_sqlite_is_rejected_before_open(self):
        self.check_probe("import sqlite3; sqlite3.connect('/nonexistent-ci-forbidden.sqlite3')")

    def test_production_port_is_rejected_before_connect(self):
        self.check_probe("import socket; socket.socket().connect(('127.0.0.1',8190))")

    def test_external_network_is_rejected_before_connect(self):
        self.check_probe("import socket; socket.socket().connect(('192.0.2.1',443))")

    def test_model_cli_is_rejected_before_spawn(self):
        self.check_probe("import subprocess; subprocess.run(['forbidden-synthetic-model-cli'])")
