import io
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

import launch


class LaunchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='localgpt-launch-test-')
        self.root = Path(self.temp.name)
        self.state = self.root/'state'
        self.root_patch = patch.object(launch, 'ROOT', self.root)
        self.state_patch = patch.object(launch, 'STATE', self.state)
        self.root_patch.start(); self.state_patch.start()
        (self.root/'index.html').write_bytes(b'isolated launcher fixture')
        with socket.socket() as s:
            s.bind(('127.0.0.1', 0)); self.port = s.getsockname()[1]
        self.children = []
        popen = subprocess.Popen
        def spawn(*args, **kwargs):
            child = popen(*args, **kwargs); self.children.append(child); return child
        self.spawn_patch = patch.object(launch.subprocess, 'Popen', side_effect=spawn)
        self.spawn = self.spawn_patch.start()
        self.browser_patch = patch.object(launch.webbrowser, 'open')
        self.browser = self.browser_patch.start()

    def tearDown(self):
        for child in self.children:
            if child.poll() is None: child.terminate()
            child.wait(timeout=5)
        starts = self.root/'starts'
        if starts.exists():
            for pid in map(int, starts.read_text().splitlines()):
                try: os.kill(pid, signal.SIGTERM)
                except ProcessLookupError: pass
        self.browser_patch.stop(); self.spawn_patch.stop()
        self.root_patch.stop(); self.state_patch.stop(); self.temp.cleanup()

    def fixture(self, delay=.6, exit_code=None):
        (self.root/'serve.py').write_text(f'''
import argparse,json,os,time
from pathlib import Path
from http.server import BaseHTTPRequestHandler,HTTPServer
root=Path(__file__).parent
with (root/'starts').open('a') as f:f.write(str(os.getpid())+'\\n')
p=argparse.ArgumentParser();p.add_argument('--port',type=int);a=p.parse_args()
time.sleep({delay!r})
if {exit_code!r} is not None:raise SystemExit({exit_code!r})
class Handler(BaseHTTPRequestHandler):
 def do_GET(self):
  body=json.dumps({{'service':'hanzagent'}}).encode() if self.path.endswith('/health') else (root/'index.html').read_bytes()
  self.send_response(200);self.end_headers();self.wfile.write(body)
 def log_message(self,*args):pass
HTTPServer(('127.0.0.1',a.port),Handler).serve_forever()
''')

    def test_pending_reuses_child_after_launcher_returns(self):
        self.fixture()
        first=launch.launch(self.port, wait_seconds=0)
        self.assertTrue(first['starting']); self.browser.assert_not_called()
        second=launch.launch(self.port, wait_seconds=0)
        self.assertTrue(second['starting']); self.assertEqual(self.spawn.call_count,1)
        ready=launch.launch(self.port, open_browser=False, wait_seconds=5)
        self.assertEqual(ready['service'],'hanzagent'); self.assertNotIn('starting',ready)
        self.assertEqual(len((self.root/'starts').read_text().splitlines()),1)
        self.assertEqual(self.spawn.call_count,1)
        self.assertEqual(launch.launch(self.port,open_browser=False),ready)

    def test_ready_after_old_fifteen_second_window(self):
        now=[0.0]; process=Mock(); process.poll.return_value=None
        def probe(_): return {'service':'hanzagent'} if now[0]>=20 else None
        def sleep(seconds):now[0]+=seconds
        with patch.object(launch,'probe',side_effect=probe), patch.object(launch.time,'monotonic',side_effect=lambda:now[0]), patch.object(launch.time,'sleep',side_effect=sleep), patch.object(launch.subprocess,'Popen',return_value=process), patch.object(launch.urllib.request,'urlopen',return_value=io.BytesIO((self.root/'index.html').read_bytes())):
            result=launch.launch(self.port,open_browser=False)
        self.assertEqual(now[0],20);self.assertNotIn('starting',result)

    def test_child_exit_is_failure(self):
        self.fixture(delay=0,exit_code=23)
        with self.assertRaisesRegex(RuntimeError,'code 23'):
            launch.launch(self.port,wait_seconds=5)
        self.browser.assert_not_called()

    def test_pending_child_exit_is_not_replaced(self):
        self.fixture(delay=.3,exit_code=23)
        self.assertTrue(launch.launch(self.port,wait_seconds=0)['starting'])
        with self.assertRaisesRegex(RuntimeError,'previous startup process exited'):
            launch.launch(self.port,wait_seconds=5)
        self.assertEqual(self.spawn.call_count,1)

    def test_foreign_port_is_preserved(self):
        with socket.socket() as occupied:
            occupied.bind(('127.0.0.1',self.port));occupied.listen()
            with patch.object(launch,'probe',return_value=None):
                with self.assertRaisesRegex(RuntimeError,'No duplicate'):
                    launch.launch(self.port,wait_seconds=0)
            self.assertTrue(launch.port_open(self.port));self.spawn.assert_not_called()

    def test_wrong_service_is_not_opened(self):
        with patch.object(launch,'probe',return_value={'service':'other'}):
            with self.assertRaisesRegex(RuntimeError,'another service'):launch.launch(self.port)
        self.browser.assert_not_called();self.spawn.assert_not_called()

    def test_different_checkout_is_not_opened(self):
        with patch.object(launch,'probe',return_value={'service':'hanzagent'}), patch.object(launch.urllib.request,'urlopen',return_value=io.BytesIO(b'different UI')):
            with self.assertRaisesRegex(RuntimeError,'different checkout'):launch.launch(self.port)
        self.browser.assert_not_called();self.spawn.assert_not_called()

    def test_symlink_lock_rejected_without_touching_target(self):
        self.state.mkdir(); target=self.root/'untouched';target.write_text('keep')
        (self.state/f'launch-{self.port}.lock').symlink_to(target)
        with self.assertRaises(OSError):launch.launch(self.port,wait_seconds=0)
        self.assertEqual(target.read_text(),'keep');self.spawn.assert_not_called()

    def test_invalid_wait_budget(self):
        for value in [-1,float('nan'),float('inf')]:
            with self.subTest(value=value),self.assertRaises(ValueError):launch.launch(self.port,wait_seconds=value)
        self.spawn.assert_not_called()

    def test_launcher_exit_keeps_child_lease(self):
        self.fixture(delay=1)
        module_dir=Path(launch.__file__).parent
        script=f"import sys;sys.path.insert(0,{str(module_dir)!r});import launch;from pathlib import Path;launch.ROOT=Path({str(self.root)!r});launch.STATE=Path({str(self.state)!r});print(launch.launch({self.port},False,0))"
        result=subprocess.run([sys.executable,'-c',script],capture_output=True,text=True,timeout=5)
        self.assertEqual(result.returncode,0,result.stderr);self.assertIn("'starting': True",result.stdout)
        ready=launch.launch(self.port,False,5)
        self.assertNotIn('starting',ready);self.spawn.assert_called_once()  # only the exited launcher process
        self.assertEqual(len((self.root/'starts').read_text().splitlines()),1)

    def test_concurrent_launchers_spawn_once(self):
        self.fixture(delay=.6)
        module_dir=Path(launch.__file__).parent
        script=f"import sys;sys.path.insert(0,{str(module_dir)!r});import launch;from pathlib import Path;launch.ROOT=Path({str(self.root)!r});launch.STATE=Path({str(self.state)!r});print(launch.launch({self.port},False,5))"
        callers=[subprocess.Popen([sys.executable,'-c',script],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True) for _ in range(2)]
        for caller in callers:
            stdout,stderr=caller.communicate(timeout=8)
            self.assertEqual(caller.returncode,0,stderr)
            self.assertIn("'service': 'hanzagent'",stdout)
            self.assertNotIn('starting',stdout)
        self.assertEqual(len((self.root/'starts').read_text().splitlines()),1)

    def test_cli_pending_is_not_reported_as_running(self):
        self.fixture(delay=.6)
        script=self.root/'launch.py';script.write_text(Path(launch.__file__).read_text())
        env={**os.environ,'HOME':str(self.root/'isolated-home')}
        args=[sys.executable,str(script),'--port',str(self.port),'--no-open','--wait-seconds']
        result=subprocess.run(args+['0'],env=env,capture_output=True,text=True,timeout=5)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('still starting in the background',result.stdout)
        self.assertNotIn('is running independently',result.stdout)
        ready=subprocess.run(args+['5'],env=env,capture_output=True,text=True,timeout=8)
        self.assertEqual(ready.returncode,0,ready.stderr)
        self.assertIn('is running independently',ready.stdout)
        self.assertEqual(len((self.root/'starts').read_text().splitlines()),1)


if __name__=='__main__':unittest.main()
