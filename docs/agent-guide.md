# LocalGPT agent guide

[English](agent-guide.md) · [简体中文](agent-guide.zh-CN.md) · [Agent entry](../AGENTS.md)

## Ownership and files

Codex coordinates and implements. Native subagents independently review the final commit and perform authorized merges after checks pass. Do not call bots, external bridges or cloud agents. Historical collaboration documents do not override this workflow.

| Location | Purpose |
| --- | --- |
| `work/chat-sidebar/` | Runtime Python, browser source, build and backend tests |
| `tools/` | Audits, synthetic demos and acceptance utilities |
| `assets/` | Reviewed source artwork |
| `docs/` | Current user/agent guides and technical contracts |
| `docs/history/` | Earlier designs, collaboration and acceptance evidence |
| `docs/releases/` | Immutable release scope and upgrade notes |
| `VERSION.txt` | Canonical application version |

Keep generated `index.html`, virtual environments, screenshots, runtime data and local evidence out of Git. The enclosing `Local_First` workspace is not the publishable repository. Its old checkouts, outputs and investigation folders must not be imported or moved as part of source cleanup.

## Change workflow

1. Inspect branch, remote, working tree, current version and relevant instructions. Preserve existing edits. If a checkout serves the user's application, use an isolated clone for repository work.
2. Create a `codex/` branch. Implement a bounded change and update the corresponding English/Chinese guides. Record intended changes under `Unreleased` until preparing a release.
3. Run the [appropriate checks](testing.md), inspect the staged diff, and run source/index and history audits. Use disposable test stores and synthetic services.
4. Push the branch and open a draft PR with behavior, scope, validation and limitations. A native subagent reviews the exact final head; resolve findings and rerun affected checks after edits.
5. When the task authorizes merge, a subagent verifies the head and base, review findings and required checks, marks the PR ready and merges. Do not bypass repository rules. Same-account agent review must be described as such, not as a GitHub APPROVED review.
6. For a release task, follow the [release policy](versioning.md). Otherwise leave the validated PR ready for the next authorized step.

Pending PR #26 is a separate crash-recovery change with its own unresolved acceptance gates. Do not merge it or claim it ships merely because this documentation release succeeds.

## Runtime boundaries

The API prefix `/qwen-cn/`, database paths, browser keys, model ownership IDs and `HanzAgent` support directory are compatibility identifiers. Changing them requires a deliberate migration. Updating source or publishing a tag does not restart a service. Installation, real-model calls, data migrations and production maintenance require authorization within the task.

Read [architecture](ARCHITECTURE.md), [privacy](PRIVACY.md) and [Projects](PROJECTS.md) before modifying storage or runtime behavior. Do not weaken guards or change real model settings to make tests pass. Report actual evidence and remaining limitations.
