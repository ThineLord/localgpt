# Changelog

Released versions follow [the version policy](versioning.md). `VERSION.txt` is the application version; database schemas and historical Round numbers are separate identifiers.

## [Unreleased]

### Fixed

- DOCX preview and project retrieval keep a normal tab, a soft line break, the break between paragraphs, and adjacent text runs. A DOCX already saved with the older extraction keeps that text and index until the same file is uploaded again. The upload refreshes the same source and does not change original bytes or existing messages.
- Finishing a reference-image upload on a new chat that has no id yet waits while another chat is still opening. If that open succeeds, the page stays on the opened chat, the editor keeps that chat's text, and the next edit is saved there. If the open fails, the finished upload is saved on the original draft and the image is not uploaded again.
- Opening another chat while a reference image is still uploading does not drop that image when the open fails and this page is still the chat that selected it. The finished upload is saved on that chat, and the message that the other chat failed to open stays. Leaving that chat, including leaving and returning before the upload finishes, still does not add the image.
- Choosing a reference image on a saved chat, or on a new chat that has no id yet, does not write that image into another project opened before the upload finishes. The other project keeps its draft and mode. Text already typed on the first chat stays there, and the page says the image was not added. Typing in a new chat and choosing an image without leaving still attaches the image to that chat when autosave gives it an id during the upload, and the text stays.
- Inline code keeps the characters inside it. Asterisks in fragments such as `a * b * c`, `**literal**`, and `*.py and *.js` stay visible in paragraphs, lists, and headings. Bold and italic outside that code still apply, including emphasis around one or more code spans, and fenced blocks still copy their original text.
- A slow project list or project detail refresh no longer replaces the project already open, and an older successful snapshot no longer replaces a newer title for that same project. A delayed failure is shown only for the refresh that is still current: it does not appear on another project or on an ordinary chat. Deleting the project that is still open still leaves the page and reports that it was moved to trash.
- A project list refresh that starts after another project has already begun to open does not treat the project still on screen as the one to leave, so it does not cancel that open. If the open fails and the deleted project is still on screen, the page then leaves it and reports that it was moved to trash.
- Confirming an input-method candidate in the project name field no longer creates or renames the project. Enter with `isComposing` set, or with key code 229, does not call `preventDefault` and does not save, for both create and edit. An ordinary Enter or the save button still saves once.
- Reloading a chat that already has a saved draft keeps an unresolved conflict in the existing `hanz-transient-draft` sessionStorage record: the local text and the original base stay until an explicit save or an explicit choice. Refreshing again does not overwrite the server, and another chat or project does not apply or delete that record.
- A draft conflict that is still waiting for a choice is not auto-saved when the saved text returns to the original base. Reopening that chat from the sidebar, its project, or a fresh load restores its local text and the choice. Pending drafts for different chats, projects, and a new chat that has not been saved stay under the same key; an explicit save or choice clears only the resolved scope.
- An ordinary edit or save of a chat that already has an id does not claim the same-project `hanz-transient-draft` record that still has no chat id. That claim happens only in the successful POST that creates the new chat. Typing a new chat, opening an existing chat in the same tab before the 450ms autosave, and then saving that existing chat still restores the unsaved text.

## [0.3.0] - 2026-11-19

- Appearance can leave the background plain or show a dynamic wallpaper drawn in the browser. It stays off until chosen. The first styles are a black-white-gray cube field, Starry Night, and Water Lilies. The choice is kept in this browser, follows the interface language, and can be paused or resumed in Appearance. A hidden tab or a system request for reduced motion also suspends animation.

- Regenerating an earlier turn uses only its preceding conversation history. The elapsed timer starts at the new attempt while the turn keeps its place in the transcript.

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
