"""Verify the locked test environment without installing or contacting services."""
import importlib.metadata
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
errors = []
for line in (ROOT/'requirements-test.txt').read_text().splitlines():
    if not line or line.startswith('#'): continue
    name, expected = line.split('==')
    try: actual = importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError: actual = 'missing'
    if actual != expected: errors.append(f'{name}: expected {expected}, found {actual}')
try:
    browser = subprocess.check_output(['node','-e',"const p=require('./tools/browser/node_modules/playwright/package.json');const {chromium}=require('./tools/browser/node_modules/playwright');if(!require('fs').existsSync(chromium.executablePath()))throw Error('Managed Chromium missing');console.log(JSON.stringify({playwright:p.version,node:process.version,chromium:chromium.executablePath()}));"],cwd=ROOT,text=True,stderr=subprocess.STDOUT)
    identity = json.loads(browser)
    expected = json.loads((ROOT/'tools/browser/package.json').read_text())['devDependencies']['playwright']
    if identity['playwright'] != expected: errors.append('Playwright version differs from lock')
    print(json.dumps(identity))
except (OSError, subprocess.CalledProcessError, ValueError) as error:
    errors.append('Pinned Playwright/Chromium unavailable: '+str(error))
for error in errors: print(error)
print('Python:',sys.version.split()[0])
if errors:
    print('Activate .venv and run python tools/validate.py --setup.')
    raise SystemExit(1)
print('Pinned dependencies and managed browser are available.')
