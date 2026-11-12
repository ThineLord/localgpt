# Changelog

Released versions follow [the version policy](versioning.md). `VERSION.txt` is the application version; database schemas and historical Round numbers are separate identifiers.

## [Unreleased]

- Regenerating a reply replaces that turn's answer. The same prompt is not added as another turn.
- Turning global memory off asks for confirmation. Saved entries stay until they are deleted separately.
- The generation settings panel uses the 1280×800 viewport, so quality, prompt strength, and seed stay on screen.
- After Stop, the stopped turn stays in the transcript: the prompt and any partial reply remain visible, and Send stays usable.
- A finished reply replaces the longer in-progress text. Think-tag cleanup stays: the answer is the final text and the reasoning stays separate. Longer partial text is kept only while the arriving snapshot is still in progress.
- The memory delete confirmation shows its confirm label. Deletion still requires that confirmation.
- English mid-generation status says “Generating” instead of the untranslated “正在生成”. Chinese status text is unchanged.
- The create-project example reads as a placeholder, so Create stays off until a real name is typed. Sidebar New project and + open that same dialog.
- After a reply finishes or is stopped, the caret returns to the composer and Send is usable without clicking the field first.
- English copy: “1 model”, a composer placeholder with room for “say”, and an English trashed-images section.
- Simplify the repository landing page and navigation; keep earlier design records and superseded browser scripts in Git history.
- Add two reviewed screenshots captured from an isolated synthetic demo, with bilingual README captions.

## [0.2.1] - 2026-11-09

### Fixed

- Keep slow live UI startup pending instead of failing after 15 seconds. A child-held per-port lease prevents repeated or concurrent launchers from starting duplicate processes.
- Clear stop-request feedback when its generation reaches a terminal state; a late acknowledgement cannot restore the waiting notice or overwrite another status.

## [0.2.0] - 2026-11-09

### Fixed

- Recover recognized abandoned chat/routing generations using shared POSIX ownership. Preserve partial output and request identity; never replay model calls or clear unknown legacy owners.
- Generate clearly labeled synthetic PNGs through production preview/download routes. Production SVG rejection is unchanged.
- Restore focus to the Memory settings trigger when closing its nested dialog.
- Publish chat completion after asynchronous resource cleanup, avoiding a brief ownership conflict on the next send.
- Keep extension diagnostics functional across cached package reloads and respect ComfyUI's configured port.

### Added

- About and health expose build version/commit and the running process's startup identity. Local diagnostics independently probe application health, LM Studio and ComfyUI without starting inference.
- A pinned one-command synthetic acceptance runner, isolated fixtures, machine-readable results, per-case screenshots/video and an explicit historical-test coverage map.

### Performance

- Cache project source chunks and terms in SQLite; backfill existing sources lazily and retrieve off the event loop. Preserve project isolation, deletion/restore, budget semantics and cancellation.

### Upgrade

- Runtime release: upgrade both writers together on a local POSIX filesystem after quiescing work and taking a consistent backup. Additive ownership and derived index tables are not a license to mix old/new writers. See [English notes](releases/0.2.0.md) / [中文说明](releases/0.2.0.zh-CN.md).

## [0.1.0] - 2026-11-09

First versioned source baseline, based on the existing main application at `d4520a3`.

### Added

- Separate English and Chinese home pages, user guides and agent guides.
- Canonical version file, release notes, local release validation and pull request checklist.
- Codex coordination with native subagent review and merge.

### Changed

- Simplified repository landing page and added a concise project introduction.
- Grouped previous design, collaboration and acceptance records under `docs/history/`.
- Documented source, tooling, runtime data and release ownership.

### Scope

Application behavior and runtime paths are unchanged. Existing chat, image, projects and memory features form the baseline. Pending PR #26 recovery changes are excluded. Publishing this version does not install, restart or migrate a running application.

[Unreleased]: https://github.com/ThineLord/localgpt/compare/v0.2.1...HEAD
[0.1.0]: https://github.com/ThineLord/localgpt/releases/tag/v0.1.0

[0.2.0]: https://github.com/ThineLord/localgpt/releases/tag/v0.2.0

[0.2.1]: https://github.com/ThineLord/localgpt/releases/tag/v0.2.1
