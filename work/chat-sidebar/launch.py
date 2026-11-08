"""Start the local UI independently of a terminal; never kill an occupied port."""
import argparse
import fcntl
import math
import os
import stat
import json
import socket
from pathlib import Path
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser

ROOT = Path(__file__).resolve().parent
STATE = Path.home() / 'Library' / 'Application Support' / 'HanzAgent'


def probe(port):
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/qwen-cn/health', timeout=2) as r:
            value = json.load(r)
            return value if isinstance(value, dict) else None
    except (OSError, ValueError):
        return None


def port_open(port):
    with socket.socket() as connection:
        connection.settimeout(1)
        return connection.connect_ex(("127.0.0.1", port)) == 0


def acquire(fd):
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except BlockingIOError:
        return False


def verify(health, port, open_browser):
    if health.get('service') != 'hanzagent':
        raise RuntimeError(f'Port {port} is occupied by another service. It was not stopped.')
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/qwen-cn/', timeout=5) as response:
        if response.read() != (ROOT/'index.html').read_bytes():
            raise RuntimeError('Running UI belongs to a different checkout. It was not replaced.')
    if open_browser:
        webbrowser.open(f'http://127.0.0.1:{port}/qwen-cn/')
    return health


def launch(port=8190, open_browser=True, wait_seconds=120):
    if not math.isfinite(wait_seconds) or wait_seconds < 0:
        raise ValueError('wait_seconds must be finite and nonnegative')
    health = probe(port)
    if health:
        return verify(health, port, open_browser)
    STATE.mkdir(parents=True, exist_ok=True)
    # The child keeps this lease even if its launcher exits before it binds.
    # Never unlink it or explicitly unlock the shared open-file-description.
    fd = os.open(STATE/f'launch-{port}.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1:
            raise RuntimeError('Unsafe startup lock file')
        owns_lock = acquire(fd)
        process = None
        if owns_lock:
            health = probe(port)
            if health:
                return verify(health, port, open_browser)
            if port_open(port):
                raise RuntimeError(f'Port {port} is running but health is unavailable. No duplicate process was started.')
            log_path = STATE/'service.log'
            with log_path.open('ab') as log:
                process = subprocess.Popen([sys.executable, str(ROOT/'serve.py'), '--port', str(port)],
                    cwd=ROOT, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                    start_new_session=True, close_fds=True, pass_fds=(fd,))
        deadline = time.monotonic() + wait_seconds
        while True:
            health = probe(port)
            if health:
                return verify(health, port, open_browser)
            if process is not None and process.poll() is not None:
                raise RuntimeError(f'LocalGPT exited during startup (code {process.returncode}). See {STATE/"service.log"}')
            if not owns_lock and acquire(fd):
                raise RuntimeError(f'The previous startup process exited before becoming available. See {STATE/"service.log"}')
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return {'service':'hanzagent', 'starting':True, 'port':port}
            time.sleep(min(.5, remaining))
    finally:
        os.close(fd)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port',type=int,default=8190)
    parser.add_argument('--no-open',action='store_true')
    parser.add_argument('--wait-seconds', type=float, default=120, help='Readiness wait budget; a slow live process continues in the background')
    args=parser.parse_args()
    result=launch(args.port,not args.no_open,args.wait_seconds)
    if result.get('starting'):
        print(f'LocalGPT is still starting in the background. Run this launcher again to check; it will reuse the existing process. See {STATE/"service.log"}')
    else:
        print('LocalGPT is running independently of this terminal.')
