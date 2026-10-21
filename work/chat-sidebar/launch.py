"""Start the local UI independently of a terminal; never kill an occupied port."""
import argparse
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
            return json.load(r)
    except (OSError, ValueError):
        return None


def launch(port=8190, open_browser=True):
    health = probe(port)
    if not health:
        with socket.socket() as probe_socket:
            probe_socket.settimeout(1)
            if probe_socket.connect_ex(("127.0.0.1",port)) == 0:
                raise RuntimeError(f"Port {port} is running but health is unavailable. Retry diagnostics; no duplicate process was started.")
        STATE.mkdir(parents=True, exist_ok=True)
        # Logs are local-only. No shell/environment serialization or credentials.
        log_path = STATE / 'service.log'
        with log_path.open('ab') as log:
            process = subprocess.Popen([sys.executable, str(ROOT/'serve.py'), '--port', str(port)],
                cwd=ROOT, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                start_new_session=True, close_fds=True)
        for _ in range(30):
            health = probe(port)
            if health: break
            if process.poll() is not None:
                raise RuntimeError(f'HanzAgent did not start. See {log_path}')
            time.sleep(.5)
        if not health:
            raise RuntimeError(f'Service is still starting. See {log_path}; do not start another copy.')
    if health.get('service') != 'hanzagent':
        raise RuntimeError(f'Port {port} is occupied by another service. It was not stopped.')
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/qwen-cn/',timeout=5) as r:
        if r.read() != (ROOT/'index.html').read_bytes():
            raise RuntimeError('Running UI belongs to a different checkout. It was not replaced.')
    if open_browser: webbrowser.open(f'http://127.0.0.1:{port}/qwen-cn/')
    return health


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port',type=int,default=8190)
    parser.add_argument('--no-open',action='store_true')
    args=parser.parse_args()
    launch(args.port,not args.no_open)
    print('HanzAgent is running independently of this terminal.')
