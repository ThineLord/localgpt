"""Negative controls for the runner: contested ports and interrupted acceptance."""
import http.server
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import urllib.request
import validate


class RunnerTests(unittest.TestCase):
    def test_stop_kills_descendant_that_ignores_terminate(self):
        with tempfile.TemporaryDirectory() as temporary:
            pidfile = Path(temporary)/'child.pid'
            script = "import os,signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); open(" + repr(str(pidfile)) + ", 'w').write(str(os.getpid())); time.sleep(60)"
            parent_script = "import subprocess,sys,time; subprocess.Popen([sys.executable,'-c'," + repr(script) + "]); time.sleep(60)"
            process = subprocess.Popen([sys.executable,'-c',parent_script],start_new_session=True)
            try:
                deadline = time.monotonic()+5
                while not pidfile.exists() and time.monotonic()<deadline: time.sleep(.02)
                self.assertTrue(pidfile.exists())
                descendant = int(pidfile.read_text())
                validate.stop(process)
                deadline = time.monotonic()+3
                while time.monotonic()<deadline:
                    result = subprocess.run(['ps','-p',str(descendant),'-o','stat='],capture_output=True,text=True)
                    if not result.stdout.strip() or result.stdout.strip().startswith('Z'): break
                    time.sleep(.05)
                else: self.fail('Owned descendant survived cleanup')
            finally:
                validate.stop(process)

    def test_conflicting_partial_flags_are_rejected(self):
        result = subprocess.run([sys.executable,str(validate.ROOT/'tools/validate.py'),'--case','projects','--skip-browser'],capture_output=True,text=True)
        self.assertEqual(result.returncode,2)

    def test_contested_port_does_not_accept_or_stop_another_demo(self):
        class OtherDemo(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200);self.end_headers();self.wfile.write(b'{"demo":true,"ready":true}')
            def log_message(self,*args): pass
        server=http.server.ThreadingHTTPServer(('127.0.0.1',0),OtherDemo)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            with tempfile.TemporaryDirectory() as temporary, patch.object(validate,'available_port',return_value=server.server_port):
                with self.assertRaises(RuntimeError):
                    with validate.fixture('demo',Path(temporary),os.environ.copy()):
                        self.fail('Unowned demo was incorrectly accepted')
                with urllib.request.urlopen(f'http://127.0.0.1:{server.server_port}/qwen-cn/health') as response:
                    self.assertTrue(json.load(response)['demo'])
        finally:
            server.shutdown();server.server_close();thread.join()

    def test_interrupt_replaces_old_pass_and_cleans_owned_server(self):
        with tempfile.TemporaryDirectory() as temporary:
            output=Path(temporary)
            (output/'report.json').write_text('{"status":"PASS","run_id":"old"}')
            with (output/'runner.log').open('w') as log:
                child=subprocess.Popen([sys.executable,str(validate.ROOT/'tools/validate.py'),'--case','memory-ui','--output',temporary],cwd=validate.ROOT,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
                try:
                    deadline=time.monotonic()+30
                    server_info=output/'memory-ui/server.json'
                    while time.monotonic()<deadline and not server_info.exists() and child.poll() is None:
                        time.sleep(.05)
                    self.assertTrue(server_info.exists(),(output/'runner.log').read_text())
                    report=json.loads((output/'report.json').read_text())
                    self.assertEqual(report['status'],'RUNNING');self.assertNotEqual(report['run_id'],'old')
                    server=json.loads(server_info.read_text())
                    child.send_signal(signal.SIGINT)
                    self.assertEqual(child.wait(timeout=15),130)
                    self.assertEqual(json.loads((output/'report.json').read_text())['status'],'INTERRUPTED')
                    with self.assertRaises(ProcessLookupError):os.kill(server['pid'],0)
                finally:
                    validate.stop(child)
