# Current browser acceptance

Run from the repository root with `python tools/validate.py` in the prepared virtual environment. The runner owns temporary fixtures, dynamically selected ports and child process groups. A per-run random fixture identity prevents accepting a different service on a contested port. It never uses a production database or starts real model services.

Playwright is pinned by `package.json` and `package-lock.json`; use its managed Chromium, not a machine-dependent Chrome installation. `--setup` installs the pinned test dependencies and browser before running. No npm frontend build is needed.

Fifteen current contracts cover draft conflict choices, language, empty layout, chat rename/trash/undo, scrolling, settings shell, avatar lifecycle, navigation, image/reference lifecycle, gallery preview/download, memory API/UI, pinned sidebar, release flows and Projects source/context integration. Existing successful contracts are adapted as named CommonJS modules; the memory/sidebar CLI contracts keep their full assertions. New flows assert versions, diagnostics, stop/retry, PNG bytes and actual project context sent to a synthetic model endpoint.

Each case uses fresh data. Screenshots and failure images are written below that case's output directory. Reports/logs are in `output/validation/` by default, all ignored by Git. A synthetic answer/image is not a real inference result. The former Round scripts and their coverage map are available through [fixed Git-history links](../../docs/history.md).
