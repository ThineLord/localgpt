# Local validation

Run commands from the repository root with dependencies installed in `.venv`. Node.js is used only for JavaScript syntax/acceptance utilities; there is no npm frontend build.

## Documentation and release changes

```sh
python3 tools/check_release.py
.venv/bin/python work/chat-sidebar/build.py
.venv/bin/python work/chat-sidebar/build.py --check
git diff --check
```

Stage new documentation before the final release check so it is included in the Git source inventory. The release checker validates version syntax, bilingual release metadata and local Markdown file/fragment links across the source tree, including historical records. It makes no network calls. Build verification checks the generated page but does not start a service.

After staging the intended changes, inspect `git diff --cached` and run:

```sh
python3 tools/audit_source.py
python3 tools/audit_source.py --history
```

The audit scans Git objects, not arbitrary runtime folders. It supplements human privacy review; it does not prove all arbitrary prose is free of personal data.

## Runtime changes

```sh
.venv/bin/python -m unittest discover -s work/chat-sidebar -p 'test_*.py' -v
.venv/bin/python -m unittest discover -s tools -p 'test_*.py' -v
node --check work/chat-sidebar/app.js
node --check work/chat-sidebar/workspace.js
node --check work/chat-sidebar/projects.js
```

Check any other changed JavaScript modules too. UI changes also require browser checks with the synthetic demo. `tools/projects_demo.py` provides the project fixture on 8194. Live acceptance scripts contact local models and are separate from routine checks; run only when authorized. Earlier dated acceptance records do not validate a new version.

## Release evidence

Record the exact PR head, command results, review findings and limitations in the PR; record the merged/tagged SHA with the release handoff. A skipped GitHub check is not a pass. If no remote workflow exists, report local validation explicitly. Source publication is not runtime deployment or real-model verification.
