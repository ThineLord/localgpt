# Synthetic backend acceptance

Run from a clean committed checkout, after installing `requirements-ci.txt`:

```sh
python tools/ci.py --expected-sha "$(git rev-parse HEAD)"
```

This builds/checks the generated UI, scans indexed source for private runtime
files and credentials, runs every backend and tool unittest (including real
SIGKILL/ownership/SQLite-atomicity regressions), requires complete HTTP recovery
receipts, and verifies source/test bytes are unchanged. Skips, expected failures,
missing test discovery, or incomplete worker cleanup fail acceptance. Fresh HOME
and temporary roots isolate synthetic chat, Memory and image fixtures. No real
LM Studio, ComfyUI, user database, WAL, or production launcher is needed.

The Python guard blocks SQLite outside the fresh temporary root, external DB
file reads, non-loopback traffic, production ports, fixed-port listeners, model
CLIs and shell commands. It is defense in depth for reviewed tests, not a hostile
code sandbox. Reviewed ownership children use synthetic arguments; HTTP children
add an exact mock-port and per-directory guard. No production HTTP health probe
is part of CI. Existing baseline-failure evidence remains in the LG1 receipt;
CI does not repeat the original investigation.

## Remote cost authorization

The workflow requests only `contents: read`, pinned official actions, one
standard Ubuntu runner with a ten-minute job timeout, no matrix, cache, artifact
upload, secrets, deployment, or self-hosted runner. A private repository's runner
minutes can cost money after its included allowance is exhausted.

A job runs only if the repository variable `APP03_CI_AUTHORIZED_SHA` equals the
exact PR head (or dispatch SHA). The variable is deliberately not provisioned by
this patch. Before setting it, an authorized operator must verify current
included quota and existing spending controls prove zero additional charge for
this bounded run, including concurrent usage. Do not change billing, permission,
or security settings to make the run possible. A SHA change invalidates this
authorization. If proof is unavailable, leave the variable absent and record
remote CI as BLOCKED. A skipped workflow is never CI PASS or Final Acceptance.

Once cost is proven, set the variable to the reviewed SHA and rerun the PR
workflow from Actions (or use workflow_dispatch once this workflow exists on the
default branch). A local green result does not substitute for a completed remote
run on the exact SHA. Revalidate the final SHA, independent review, local tests,
remote check results, repository rules, and absence of deployment side effects
before merging. Merge does not authorize production deployment or migration.
