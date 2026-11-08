# Changelog

Released versions follow [the version policy](docs/versioning.md). `VERSION.txt` is the application version; database schemas and historical Round numbers are separate identifiers.

## [Unreleased]

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

- Runtime release: upgrade both writers together on a local POSIX filesystem after quiescing work and taking a consistent backup. Additive ownership and derived index tables are not a license to mix old/new writers. See [English notes](docs/releases/0.2.0.md) / [中文说明](docs/releases/0.2.0.zh-CN.md).

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
