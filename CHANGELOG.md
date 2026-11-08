# Changelog

Released versions follow [the version policy](docs/versioning.md). `VERSION.txt` is the application version; database schemas and historical Round numbers are separate identifiers.

## [Unreleased]

- Cache project source chunks/terms in SQLite and retrieve off the event loop; add scope, rebuild, rollback and performance regression checks.
- Render and download demo images through the production image routes using labeled synthetic PNGs.

- Recover interrupted chat generations with shared POSIX ownership across the UI and ComfyUI writers; preserve partial answers and request identity. Unknown legacy ownership remains blocked.

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

[Unreleased]: https://github.com/ThineLord/localgpt/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ThineLord/localgpt/releases/tag/v0.1.0
