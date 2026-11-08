# Local validation

[English](testing.md) · [简体中文](testing.zh-CN.md)

The current acceptance command is:

```sh
python3 -m venv .venv
.venv/bin/python tools/validate.py --setup
```

This installs exact Python dependencies from `requirements-test.txt`, runs `npm ci` against the browser lockfile and installs Playwright's managed Chromium. The initial setup downloads dependencies; subsequent runs use `.venv/bin/python tools/validate.py`. Tested with Python 3.13 and Node 26 on macOS; the runtime ownership protocol requires macOS/Linux POSIX file locking. Node/npm are validation dependencies, not a frontend build system.

The full synthetic suite runs build consistency, release/Markdown links, all backend and tool tests, current JavaScript syntax, staged/worktree diff, source/index/history audits, the retrieval benchmark and fifteen browser/API contracts. Each browser case gets temporary data, its own server and an exact random fixture identity. All owned processes and temporary data are cleaned up on success, failure or interruption. Existing services and personal databases are not used.

Results are written to `output/validation/report.json`, with per-check logs and per-case screenshots. `PASS` means all current synthetic checks passed; it does not mean real inference passed. Environment failures are `BLOCKED`, nonzero test exits are `FAIL`, timeouts are `TIMEOUT`; an interrupted run is `INTERRUPTED`. Failed or blocked checks return nonzero. Reports start as `RUNNING` with a unique run ID, so a prior pass is not reused. `--browser-only`, `--skip-browser` and `--case projects` are explicitly partial and can only produce `PARTIAL_PASS`.

The source audits inspect Git objects, so stage intended source changes before the final run. Review the staged diff for personal information too: pattern checks cannot prove arbitrary prose is safe. Source archives lack Git history and are not a substitute for clean-clone release acceptance.

## Scope and evidence

See the [current browser contracts](../tools/browser/README.md) and [historical coverage map](../tools/history/browser/README.md). Historical scripts are retained for provenance and do not count as current passing acceptance. The project benchmark uses repeated synthetic text at 1×10k, 20×100k and 100×200k characters; its latency guard is a regression check for that fixture, not a guarantee for every document corpus.

Live inference remains opt-in and separate: `tools/projects_live_acceptance.py` and `tools/round7_memory_live_acceptance.py` require running local model services and task authorization. Report connection failures as environment blockers. Do not start services, load models or alter production data merely to turn synthetic acceptance green.

For a release, validate the final reviewed head, have an authorized native subagent merge, then rebuild and run the full suite on the exact merged/tagged commit. Record local results and limitations. A missing/skipped GitHub workflow is not a successful remote check; source publication is separate from runtime deployment.
