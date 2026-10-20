"""Fail closed on non-source staged content; report paths/rules, never matched values."""
import re, subprocess, sys
from pathlib import PurePosixPath
names=subprocess.check_output(['git','diff','--cached','--name-only','--diff-filter=ACMR','-z']).decode().split('\0')
rules={
 'credential':rb'(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{24,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY)',
 'secret_assignment':rb'(?i)(?:api_key|password|access_token|client_secret)\s*[:=]\s*[\"\x27][^\"\x27\s]{8,}[\"\x27]',
 'personal_home':rb'/'+rb'Users/[^/\s]+/',
}
fail=[]
for name in filter(None,names):
 p=PurePosixPath(name)
 if p.suffix not in ('.py','.js','.css','.html','.md','.txt','.yml','.yaml','.example') and name not in ('.gitignore',):fail.append((name,'not approved source format'));continue
 if any(x in p.parts for x in ('output','outputs','data','backups','logs','.playwright-cli')):fail.append((name,'runtime directory'))
 data=subprocess.check_output(['git','show',':'+name])
 for rule,pattern in rules.items():
  if re.search(pattern,data):fail.append((name,rule))
print('Staged source files:',len(list(filter(None,names))))
for name,rule in fail:print(name,rule)
if fail:sys.exit(1)
print('Staged filename and credential checks passed.')
