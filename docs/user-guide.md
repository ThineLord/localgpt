# LocalGPT user guide

[English](user-guide.md) · [简体中文](user-guide.zh-CN.md) · [Home](../README.md)

## Start with the demo

Follow the [home page setup](../README.md#try-it-locally). macOS/Linux with Python 3.10+ is the supported setup baseline; generation ownership requires POSIX file locks. Native Windows is not supported. The demo serves port 8191, uses a disposable database, and generates synthetic answers and images without contacting a model. Keep its terminal open; Ctrl+C stops it.

## Local services

The real application is intended for an existing local installation. The macOS launcher and application-support paths are platform-specific; the portable demo is the simplest first run elsewhere.

1. Install dependencies in the repository's `.venv` and build with `.venv/bin/python work/chat-sidebar/build.py`.
2. Run LM Studio's local server on `127.0.0.1:1234`, with its `lms` executable available. The existing default text model is `qwen3-8b`.
3. Start your existing ComfyUI service on `127.0.0.1:8188` with the LocalGPT extension (legacy installation name `qwen-local-app`). The extension consists of `backend.py` installed as `__init__.py`, `storage.py`, `lm_chat.py`, `generation.py`, `generation_ownership.py` and built `index.html` from `work/chat-sidebar/`. Installing/updating this extension is a separate local maintenance task; the demo does not perform it.
4. Run `.venv/bin/python work/chat-sidebar/launch.py`, or double-click `Start LocalGPT.command` on macOS. Open **http://127.0.0.1:8190/qwen-cn/**. The launcher detaches the UI process from its terminal and refuses to replace an occupied service. For foreground debugging, use `.venv/bin/python work/chat-sidebar/serve.py`.

ComfyUI must run once so the UI can discover the existing database and image paths through `/qwen-cn/health`. After discovery, text chat can work with ComfyUI stopped; image generation still requires it. LM Studio and model files are separate installations. Image generation expects the Qwen Image 2.1 GGUF, Qwen3-VL encoder, VAE and custom nodes named in `generation.py` (`UnetLoaderGGUF`, `TextEncodeQwenImage21`, `QwenImage21Cache`). They are not distributed here. Do not change model names merely to make a demo pass.

Before using permanent deletion with an older extension, back up the store and update all writers together, including `storage.py`, `generation.py` and `backend.py`; restart ComfyUI only with an idle queue. Legacy deletion routes on 8188 are rejected after the lifecycle upgrade; use 8190 for lifecycle controls.

## Daily use

Create a conversation for text or image work. Drafts and history persist locally. Organize related conversations, instructions and sources into projects; project memory scope is chosen at creation. Files support local text/code, PDF text and DOCX paragraphs, with no OCR. Sources are indexed locally at import; older sources are indexed in the background on first use. See [Projects](PROJECTS.md) for limits and recovery.

Settings controls language, appearance, avatar and saved memory. Automatic memory capture defaults off for new settings. Pausing recall preserves saved memories; deleting a memory affects future recall without rewriting old messages. Gallery and trash operations have their own confirmation and retention behavior; review the dialog before deleting.

## Data and upgrades

The existing SQLite database, uploads/output, project-memory directory, avatar directory and migration backups remain on this computer. Browser preferences also use local browser storage. The runtime caches discovered paths under the legacy `HanzAgent` application-support directory. Repository cleanup does not rename those paths or API routes.

Use a release tag when installing. For an existing installation, first read the target release notes and inspect local changes. Fetch tags with `git fetch origin --tags`; switch versions only in a clean, inactive checkout. Installing a source release and upgrading a running service are separate operations. Back up the full data set and stop all writers before any separately planned data restoration. Do not overwrite current data with an older backup after new activity.

The upcoming runtime release adds recovery for interrupted chat tasks created by upgraded writers. Partial answers remain visible and Retry is explicit; no model call is replayed automatically. Upgrade the UI and ComfyUI extension together, including `generation_ownership.py`. Unknown legacy tasks stay blocked for deliberate maintenance; do not delete database rows or the generation lock manually. See [recovery and upgrade requirements](APP03_RECOVERY.md). Version 0.1.0 itself remains the earlier documentation-only baseline.

## Troubleshooting

- Demo port occupied: stop your own previous demo or use `demo.py --help` for its port option; do not kill an unknown process.
- Real UI cannot discover data: start the configured ComfyUI extension and confirm its health endpoint first.
- Launcher reports another checkout: finish maintenance of the owned service before switching; the launcher deliberately leaves it running.
- Missing model/node: fix the local service installation; a successful synthetic demo does not verify real inference.
