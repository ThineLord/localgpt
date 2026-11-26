# LocalGPT user guide

[English](user-guide.md) · [简体中文](user-guide.zh-CN.md) · [Home](../README.md)

## Start with the demo

Follow the [home page setup](../README.md#try-it-locally). macOS/Linux with Python 3.10+ is the supported setup baseline; generation ownership requires POSIX file locks. Native Windows is not supported. The demo serves port 8191, uses a disposable database, and generates synthetic answers and images without contacting a model. Keep its terminal open; Ctrl+C stops it.

## Local services

The real application is intended for an existing local installation. The macOS launcher and application-support paths are platform-specific; the portable demo is the simplest first run elsewhere.

1. Install dependencies in the repository's `.venv` and build with `.venv/bin/python work/chat-sidebar/build.py`.
2. Run LM Studio's local server on `127.0.0.1:1234`, with its `lms` executable available. The existing default text model is `qwen3-8b`.
3. Start your existing ComfyUI service on `127.0.0.1:8188` with the LocalGPT extension (legacy installation name `qwen-local-app`). The extension consists of `backend.py` installed as `__init__.py`, `storage.py`, `lm_chat.py`, `generation.py`, `generation_ownership.py`, `build_info.py`, `diagnostics.py` and built `index.html` from `work/chat-sidebar/`. Installing/updating this extension is a separate local maintenance task; the demo does not perform it.
4. Run `.venv/bin/python work/chat-sidebar/launch.py`, or double-click `Start LocalGPT.command` on macOS. Open **http://127.0.0.1:8190/qwen-cn/**. The launcher detaches the UI process from its terminal and refuses to replace an occupied service. For foreground debugging, use `.venv/bin/python work/chat-sidebar/serve.py`.

ComfyUI must run once so the UI can discover the existing database and image paths through `/qwen-cn/health`. After discovery, text chat can work with ComfyUI stopped; image generation still requires it. LM Studio and model files are separate installations. Image generation expects the Qwen Image 2.1 GGUF, Qwen3-VL encoder, VAE and custom nodes named in `generation.py` (`UnetLoaderGGUF`, `TextEncodeQwenImage21`, `QwenImage21Cache`). They are not distributed here. Do not change model names merely to make a demo pass.

Before using permanent deletion with an older extension, back up the store and update all writers together, including `storage.py`, `generation.py` and `backend.py`; restart ComfyUI only with an idle queue. Legacy deletion routes on 8188 are rejected after the lifecycle upgrade; use 8190 for lifecycle controls.

## Daily use

If another window deletes the open chat, this tab opens a remaining chat or an empty composer. A separate notice keeps any unsent text available to copy and links to the reference image when available. The notice survives reloading this tab until you dismiss the copy.

Create a conversation for text or image work. Drafts and history persist locally. If a draft save fails, reopening that chat in the same tab recovers the unsent edit. Saving resumes when the service is available. If the saved version changed, the page asks which draft to keep. If another page saves the same draft first, this page keeps the unsent text and asks whether to keep it or use the saved draft. Reloading, choosing that chat again, or returning to its project keeps the question until you choose. The saved draft stays unchanged even if the other page later restores the older text. Each other chat keeps its own unsent text, including a new chat that has not been saved yet. Saving a different existing chat leaves that unsaved text in place. A reference image chosen on a saved chat, or on a new chat that has no id yet, is not added to another project if you leave before the upload finishes. That project keeps its draft and mode, text you already typed stays on the first chat, and the page says the image was not added. Choosing an image without leaving still attaches it to that same new chat when the draft is saved during the upload, and the text stays. If the other chat does not open and this page is still the one that selected the image, the finished upload is added there and the message for that failed open stays. Leaving and coming back before the upload finishes still does not add the image. If a new chat that has no id yet finishes the upload while a saved chat is still opening, a successful open stays on that saved chat, keeps its text, and stores the next edit there. A failed open still adds the finished upload to the original draft and does not upload the image again. Organize related conversations, instructions and sources into projects; project memory scope is chosen at creation. Opening a project stays on that project when an older project list or detail refresh returns, and a newer refresh keeps the title it already showed. A refresh failure is shown only for the request that is still current, so a failure for a project you left does not appear on another project or an ordinary chat. If the project you are still viewing is deleted, the page still leaves it and says it was moved to trash. A refresh that starts after another project has already begun to open does not cancel that open. If the open fails and the deleted project is still on screen, the page then leaves it and says it was moved to trash. Files support local text/code, PDF text and DOCX paragraphs, with no OCR. A DOCX keeps a normal tab, a soft line break, the break between paragraphs, and adjacent text runs beside each other. A DOCX saved with the older extraction keeps that preview and retrieval until the same DOCX is uploaded again; that upload refreshes the same source when the extracted text differs, and leaves original bytes and existing messages unchanged. The same bytes uploaded under another suffix keep the saved text and index. Sources are indexed locally at import; older sources are indexed in the background on first use. See [Projects](reference/projects.md) for limits and recovery.

Settings controls language, appearance, avatar and saved memory. Appearance can leave the background plain or show a dynamic wallpaper drawn in the browser; it stays off until selected, and the choice is kept locally. Use the motion control in Appearance to pause or resume it. Motion pauses while the tab is hidden and stays still when reduced motion is requested. Automatic memory capture defaults off for new settings. Turning personal memory off asks for confirmation first; saved entries remain. Pausing recall preserves saved memories; deleting a memory affects future recall without rewriting old messages. Regenerate replaces that turn's answer instead of adding the same prompt again. Gallery and trash operations have their own confirmation and retention behavior; review the dialog before deleting.

## Data and upgrades

The existing SQLite database, uploads/output, project-memory directory, avatar directory and migration backups remain on this computer. Browser preferences also use local browser storage. The runtime caches discovered paths under the legacy `HanzAgent` application-support directory. Repository cleanup does not rename those paths or API routes.

Use a release tag when installing. For an existing installation, first read the target release notes and inspect local changes. Fetch tags with `git fetch origin --tags`; switch versions only in a clean, inactive checkout. Installing a source release and upgrading a running service are separate operations. Back up the full data set and stop all writers before any separately planned data restoration. Do not overwrite current data with an older backup after new activity.

Version 0.2.0 adds recovery for interrupted chat tasks created by upgraded writers. Partial answers remain visible and Retry is explicit; no model call is replayed automatically. Upgrade the UI and ComfyUI extension together, including `generation_ownership.py`, `build_info.py`, `diagnostics.py`. Unknown legacy tasks stay blocked for deliberate maintenance; do not delete database rows or the generation lock manually. See [recovery and upgrade requirements](reference/recovery.md). Version 0.1.0 itself remains the earlier documentation-only baseline.

The launcher waits for readiness for up to 120 seconds. If the process is still alive after that budget, it reports **still starting** and leaves it running; it does not claim success or open the browser yet. Run the launcher again to check the same process. A per-port startup lock prevents duplicate launches even before the server binds. Keep the lock file in place. `--wait-seconds` adjusts this foreground wait; it does not cancel startup.

## Troubleshooting

- Demo port occupied: stop your own previous demo or use `demo.py --help` for its port option; do not kill an unknown process.
- Real UI cannot discover data: start the configured ComfyUI extension and confirm its health endpoint first.
- Launcher reports another checkout: finish maintenance of the owned service before switching; the launcher deliberately leaves it running.
- Missing model/node: fix the local service installation; a successful synthetic demo does not verify real inference.

## Version and local diagnostics

Settings → About shows the built interface version/commit and the running server's startup identity. A modified checkout is marked; archives without Git report an unknown commit. Rebuild after changing source, and follow the coordinated upgrade guide when restarting both writers. A server does not adopt a new version merely because files changed on disk.

Settings → Local services → Refresh diagnostics checks the application database, LM Studio's model-list endpoint and ComfyUI's queue independently. Probes are GET-only, loopback-only, do not follow redirects and have a two-second timeout. Reachable means the endpoint responded, not that a model is loaded or inference succeeded. Synthetic demos are labeled. No service is started and no generation is submitted by diagnostics.
