#!/usr/bin/env python3
"""Current, isolated release acceptance. Never starts or calls real model services."""
import argparse
import contextlib
import datetime
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
BROWSER = ROOT / 'tools' / 'browser'
CASES = {
    'draft-conflicts': 'demo', 'language': 'demo', 'empty-layout': 'gallery',
    'chat-actions': 'gallery', 'scroll': 'gallery', 'shell': 'gallery',
    'avatar': 'gallery', 'navigation': 'gallery', 'media': 'demo',
    'gallery': 'gallery', 'memory-api': 'demo', 'memory-ui': 'demo',
    'sidebar': 'gallery', 'release-flows': 'demo', 'projects': 'projects',
}
STANDALONE = {'memory-api', 'memory-ui', 'sidebar'}


def stop(process):
    # Own the entire session, including a browser whose Node parent has exited.
    def group_exists():
        try:
            os.killpg(process.pid, 0)
            return True
        except ProcessLookupError:
            return False
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    deadline = time.monotonic() + 2
    while group_exists() and time.monotonic() < deadline:
        process.poll()  # Reap the parent; descendants may still hold the group.
        time.sleep(.05)
    if group_exists():
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    process.wait()


def available_port():
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        return probe.getsockname()[1]


@contextlib.contextmanager
def fixture(kind, output, env):
    port = available_port()
    base = f'http://127.0.0.1:{port}'
    scripts = {'demo':'work/chat-sidebar/demo.py', 'gallery':'tools/round5_demo.py', 'projects':'tools/projects_demo.py'}
    with tempfile.TemporaryDirectory(prefix='localgpt-validation-') as temporary, (output/'server.log').open('w') as log:
        token = uuid.uuid4().hex
        child_env = {**env, 'TMPDIR':temporary, 'LOCALGPT_FIXTURE_TOKEN':token}
        args = [sys.executable, scripts[kind], '--port', str(port)]
        if kind == 'projects':
            args += ['--root', temporary]
        process = subprocess.Popen(args, cwd=ROOT, env=child_env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        (output/'server.json').write_text(json.dumps({'pid':process.pid,'base':base,'synthetic_only':True}))
        try:
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError('Fixture exited; see server.log')
                try:
                    with urllib.request.urlopen(base+'/qwen-cn/health', timeout=.5) as response:
                        identity = response.headers.get('X-LocalGPT-Fixture')
                        payload = json.load(response)
                    if identity == token and (payload.get('demo') or (kind == 'projects' and payload.get('database') == str(Path(temporary)/'fixture.sqlite3'))):
                        break
                except (OSError, ValueError):
                    pass
                time.sleep(.1)
            else:
                raise RuntimeError('Fixture readiness timed out; no existing service was used')
            yield base, temporary
        finally:
            stop(process)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--setup', action='store_true', help='Install pinned Python/npm dependencies and managed Chromium, then run')
    parser.add_argument('--browser-only', action='store_true', help='Partial browser validation only')
    parser.add_argument('--skip-browser', action='store_true', help='Partial non-browser validation only')
    parser.add_argument('--case', choices=sorted(CASES), help='Partial single browser case')
    parser.add_argument('--output', type=Path, default=ROOT/'output'/'validation')
    args = parser.parse_args()
    def interrupted(signum, frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, interrupted)
    if args.setup and sys.prefix == sys.base_prefix:
        parser.error('--setup requires an activated virtual environment; create .venv first')
    if args.skip_browser and (args.browser_only or args.case):
        parser.error('Choose at most one partial mode')
    output = args.output.resolve(); output.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, 'PATH':str(Path(sys.executable).parent)+os.pathsep+os.environ.get('PATH','')}
    report = {'status':'RUNNING', 'run_id':uuid.uuid4().hex, 'started_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'scope':'partial' if args.browser_only or args.skip_browser or args.case else 'full-synthetic',
              'real_inference':'not_run', 'python':sys.version, 'checks':[]}
    try:
        report['commit'] = subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
        report['working_tree_dirty'] = bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip())
    except subprocess.CalledProcessError:
        report['commit'] = 'unknown'
    def save():
        (output/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    save()
    def run(name, command, timeout=240, extra_env=None):
        start = time.monotonic()
        entry = {'name':name,'command':command, 'status':'FAIL'}
        with (output/(name+'.log')).open('w') as log:
            try:
                process = subprocess.Popen(command,cwd=ROOT,env={**env, **(extra_env or {})},stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
                try:
                    code = process.wait(timeout=timeout)
                except subprocess.TimeoutExpired:
                    code=124
                except KeyboardInterrupt:
                    report['status']='INTERRUPTED'; entry['status']='INTERRUPTED'
                    report['checks'].append(entry); save()
                    raise
                finally:
                    stop(process)
                entry.update(status='PASS' if code==0 else 'TIMEOUT' if code==124 else 'FAIL',exit_code=code)
            except OSError as error:
                entry.update(status='BLOCKED',reason=str(error));log.write(str(error))
        entry['seconds']=round(time.monotonic()-start,3)
        report['checks'].append(entry);save();print(name,entry['status'],flush=True)
        return entry['status']=='PASS'
    try:
        if args.setup:
            for name, command in [('setup-python',[sys.executable,'-m','pip','install','-r','requirements-test.txt']),
                                  ('setup-node',['npm','ci','--prefix',str(BROWSER)]),
                                  ('setup-browser',['node',str(BROWSER/'node_modules/playwright/cli.js'),'install','chromium'])]:
                if not run(name,command,600):
                    report['status']='BLOCKED';save();return 1
        if not run('environment',[sys.executable,'tools/check_test_environment.py']):
            report['checks'][-1]['status']='BLOCKED';report['status']='BLOCKED';save();return 1
        if not run('build',[sys.executable,'work/chat-sidebar/build.py']):
            report['status']='FAIL';save();return 1
        if not args.browser_only and not args.case:
            checks = [('build-check',[sys.executable,'work/chat-sidebar/build.py','--check']),
                      ('release',[sys.executable,'tools/check_release.py']),
                      ('backend',[sys.executable,'-m','unittest','discover','-s','work/chat-sidebar','-p','test_*.py','-v']),
                      ('tools',[sys.executable,'-m','unittest','discover','-s','tools','-p','test_*.py','-v']),
                      ('source-audit',[sys.executable,'tools/audit_source.py']),
                      ('history-audit',[sys.executable,'tools/audit_source.py','--history']),
                      ('diff',['git','diff','--check','HEAD']),
                      ('retrieval',[sys.executable,'tools/benchmark_retrieval.py','--check','--output',str(output/'retrieval.json')])]
            for name, command in checks:run(name,command)
            for file in sorted((ROOT/'work/chat-sidebar').glob('*.js')) + sorted(BROWSER.glob('*.cjs')):
                run('syntax-'+('browser-' if file.parent == BROWSER else 'runtime-')+file.stem,['node','--check',str(file)])
        if not args.skip_browser:
            for folder in ['round2/before','round2/after','round3','round4','round5','round6','round7','round7-memory','round8']:
                (ROOT/'output/playwright'/folder).mkdir(parents=True,exist_ok=True)
            selected = {args.case:CASES[args.case]} if args.case else CASES
            for name, kind in selected.items():
                case_output=output/name;case_output.mkdir(exist_ok=True)
                try:
                    with fixture(kind,case_output,env) as (base, fixture_root):
                        command=['node'] + ([] if name in STANDALONE else [str(BROWSER/'run-case.cjs')]) + [str(BROWSER/(name+'.cjs'))]
                        run('browser-'+name,command,180,{'LOCALGPT_TEST_BASE':base,'LOCALGPT_TEST_OUTPUT':str(case_output),'LOCALGPT_FIXTURE_ROOT':fixture_root})
                except (OSError, RuntimeError) as error:
                    report['checks'].append({'name':'browser-'+name,'status':'BLOCKED','reason':str(error)});save()
        failures=[r for r in report['checks'] if r['status']!='PASS']
        report['status']='FAIL' if failures else 'PARTIAL_PASS' if report['scope']=='partial' else 'PASS'
        report['finished_utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();save()
        print(report['status'],output/'report.json',flush=True)
        return int(bool(failures))
    except KeyboardInterrupt:
        report['status']='INTERRUPTED';save();return 130
    except Exception as error:
        report['status']='FAIL';report['error']=str(error);save();raise



if __name__ == '__main__':
    raise SystemExit(main())
