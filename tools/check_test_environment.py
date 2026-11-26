"""Verify the locked test environment without installing or contacting services."""
import importlib.metadata
import json
from pathlib import Path
import subprocess
import sys

try:
    from packaging.requirements import Requirement
except ImportError:
    raise SystemExit('Install tools/requirements-test.txt to check the pinned environment.')

ROOT = Path(__file__).resolve().parents[1]
errors = []
for line in (ROOT/'tools/requirements-test.txt').read_text().splitlines():
    if not line or line.startswith('#'): continue
    requirement = Requirement(line)
    if requirement.marker and not requirement.marker.evaluate():
        continue
    try:
        actual = importlib.metadata.version(requirement.name)
    except importlib.metadata.PackageNotFoundError:
        errors.append(f'{requirement.name}: missing')
        continue
    if actual not in requirement.specifier:
        errors.append(f'{requirement.name}: expected {requirement.specifier}, found {actual}')
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
