# LocalGPT agent entry

Read the [agent guide](docs/agent-guide.md) or [中文 Agent 指南](docs/agent-guide.zh-CN.md) before changing this repository. The human entry points are [README.md](README.md) and [README.zh-CN.md](README.zh-CN.md).

- Codex owns planning, implementation, file organization, GitHub management and release preparation. Use native subagents for independent review and merge after acceptance. Do not invoke bots, external agent bridges or cloud-agent services.
- Work on a `codex/` feature branch in an isolated checkout when the existing checkout serves a live application. Preserve user changes. Make a draft PR, validate the final commit, obtain independent subagent review, then have a subagent merge when the user's task authorizes it and repository gates pass.
- Review and merge authority applies to the current task. It does not authorize merging unrelated PRs. Do not bypass protected branches, failed required checks or unresolved findings. A same-account review is not an independent GitHub approval.
- Keep application source in `work/chat-sidebar/`, helpers in `tools/`, current guides in `docs/`, version notes in `docs/releases/`, historical records in `docs/history/`. Do not relocate runtime paths as documentation cleanup.
- Keep English and Chinese home pages and user/agent guides separate and consistent. Historical Cloud/Mason workflows are provenance only and are superseded by these instructions.
- `VERSION.txt` is the canonical application version. Every release updates it, both home pages, `CHANGELOG.md` and matching bilingual release notes. Follow [versioning](docs/versioning.md); release tags identify the reviewed merged commit.
- Never publish personal databases, chats, memory, model files, generated imagery, backups, credentials or machine-specific paths. Inspect the staged diff and run both source audits before pushing.
- Use synthetic fixtures for routine checks. Do not call real models, edit production databases, install extensions, restart running services or incur paid CI/API usage unless authorized for that task. A source release is separate from deployment.
- Run validation proportional to the change; record actual commands, results and limitations. Never treat old acceptance notes, skipped CI or unmerged code as acceptance of a new release.
