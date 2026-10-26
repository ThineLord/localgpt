# LocalGPT

Canonical private repository: [ThineLord/localgpt](https://github.com/ThineLord/localgpt).
The checkout is `work/localgpt-repository`; run commands below from that directory.
See the [repository migration and compatibility record](docs/REPOSITORY-MIGRATION.md).

A local chat and image workspace. Vanilla JavaScript, HTML and CSS; Python/aiohttp serving and SQLite persistence. No frontend framework, npm build, cloud inference, or credentials are required.

## Portable UI preview (synthetic data)

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python work/chat-sidebar/build.py
.venv/bin/python work/chat-sidebar/demo.py
```

Open http://127.0.0.1:8191/qwen-cn/ . Demo chat streaming and the labeled vector image are synthetic. It creates a temporary database and never opens your real chats or contacts a model. This is the cloud development entrypoint.

## Real local services

Start your existing ComfyUI instance with the LocalGPT extension (legacy installation name: qwen-local-app) on loopback port 8188 and LM Studio on 1234. Then build the frontend and run `.venv/bin/python work/chat-sidebar/launch.py` and open http://127.0.0.1:8190/qwen-cn/ . The launcher detaches the UI process from its terminal, verifies the occupied port and served build, and never kills another service. For foreground debugging use `serve.py`. The server discovers the existing database and image output location from `/qwen-cn/health`. It preserves existing data. The backend extension source is `backend.py` (installed as `__init__.py`) with `storage.py`, `lm_chat.py`, `generation_ownership.py`, `generation.py` and built `index.html`; installation and model acquisition are explicit local setup tasks, not performed by the demo.

Image inference requires the existing ComfyUI nodes and model files named in `generation.py`: Qwen Image 2.1 GGUF, its Qwen3-VL encoder and VAE, UnetLoaderGGUF, TextEncodeQwenImage21 and QwenImage21Cache. Models are not distributed. Chat uses locally installed LM Studio models (default qwen3-8b), `/v1/chat/completions` streaming, and its `lms` executable. The app only unloads LM Studio instances it owns. Do not change model names or settings to make UI tests pass.

Before enabling Round 4 permanent deletion, back up the existing store, update the installed extension’s `storage.py`, `generation.py` and `backend.py` (as `__init__.py`), and restart ComfyUI with an idle queue. All writers must use the deletion journal guards. Upgraded databases reject legacy deletion routes on 8188; use 8190 for lifecycle controls. No model configuration changes are needed.

Features: automatic/chat/image mode, model selection, streamed answers, stop/retry/edit/copy, image reference upload/edit/download, draft persistence and conflicts, conversation pin/unpin/rename/trash/restore, gallery, controlled local memory, Chinese/English, light/dark/system appearance. Markdown is intentionally a small escaped subset, not a full renderer.

## Projects

Create a project from the sidebar to keep chats, files and instructions together.
Projects support names, icons, colors, pinning, chat search/moves, text sources,
PDF/DOCX uploads, source previews/downloads, and recoverable deletion. ChatGPT's
Projects layout and documented interactions informed the local implementation.

Project instructions and relevant source/chat excerpts are used by the real
LM Studio chat pipeline. Choose **Default memory** to use global saved memories,
or **Project-only memory** for separate saved memories and project chat context.
The scope is fixed at creation. Project-only memories can be managed or paused
from the project's menu. The source badge on an answer lists the context actually
included in that request. Existing chats move without rewriting their messages or
drafts. See [Projects behavior, limits and recovery](docs/PROJECTS.md).

For a safe browser fixture, build and run `.venv/bin/python tools/projects_demo.py`,
then open http://127.0.0.1:8194/qwen-cn/ . Its streamed answer is explicitly
synthetic; all project routes and persistence are real and use a disposable store.
With LM Studio running, `.venv/bin/python tools/projects_live_acceptance.py` checks
one real local-model answer against a random fact in a disposable project source.
It may load the existing local qwen3-8b model through the normal app loader.
Text chat works while ComfyUI is stopped; image generation still requires ComfyUI.

The current interface follows measured signed-in navigation: a 52px rail, independent 288px pinned/temporary history panel, avatar menu and full-page settings. See [Round 4 reference and lifecycle contract](docs/ROUND4-REFERENCE.md). Earlier [design measurements](docs/DESIGN.md) and [acceptance](docs/ACCEPTANCE.md) are historical; [collaboration record](docs/COLLABORATION.md) describes that earlier delivery.

## Validation

```sh
python work/chat-sidebar/build.py
python work/chat-sidebar/build.py --check
node --check work/chat-sidebar/app.js
node --check work/chat-sidebar/workspace.js
node --check work/chat-sidebar/projects.js
python -m unittest discover -s work/chat-sidebar -p 'test_*.py' -v
python -m unittest discover -s tools -p 'test_*.py' -v
```

## Privacy

This repository contains reviewed source only. Original workspaces, history, databases, generated images, references, logs, screenshots, recordings, backups, secrets and credentials are excluded. Never `git add` an application data directory. Do not copy local `.git` objects or checkpoints into this repository. Browser preferences may be in localStorage; chat drafts/messages/memories are in the discovered SQLite database, legacy imports in `qwen-studio-history.json`, uploads/output in ComfyUI's configured directories. Migration backups remain local. Existing runtime configuration is not uploaded or overwritten.

Run `python tools/audit_source.py` after staging and before committing. It checks the complete staged index using actual Git object modes/content, rejects symlinks, submodules and unresolved conflicts, and prints no secret values. Run `python tools/audit_source.py --history` before pushing. A passing pattern scan supplements human review; it cannot prove arbitrary text contains no private information.

## Round 2 interface work

The signed-in reference contract, measured geometry and known differences are in
[Round 2 visual specification](docs/ROUND2-VISUAL-SPEC.md),
[acceptance](docs/ROUND2-ACCEPTANCE.md) and
[collaboration receipts](docs/ROUND2-COLLABORATION.md).
Use the synthetic demo for the round-two browser scripts; real history and
reference captures must remain outside version control.

## LocalGPT (Round 6)

Run `Start LocalGPT.command` after creating the project `.venv` and installing
`requirements.txt`. The existing address remains `/qwen-cn/` on port 8190.
Settings → **Profile** supports a local
PNG/JPEG/WebP preview, Cancel, Save and Reset. Originals and metadata are discarded;
only a normalized 256px PNG is kept beside the existing database in
`.localgpt-profile/avatar.png`. Nothing is uploaded to a cloud service. Reset is a
preview until Save. A stale browser cannot overwrite a newer avatar silently.

Visible branding, repository slug and checkout directory now use LocalGPT. API
paths, SQLite paths, browser storage keys, LM Studio instance ownership IDs and
the `HanzAgent` application-support directory intentionally remain legacy identifiers.
This avoids losing drafts, cached paths, backups, model ownership or saved links.
The half-knot logo is retained; this is an independent local application.
See [Round 6 delivery contract](docs/ROUND6.md) for the direct Cloud API workflow,
reference measurements and validation boundaries. Earlier round documents are
historical evidence and retain their original names.

## Round 7 navigation and memory

Chat, Gallery and Settings reuse the same live navigation rail and surface rules.
Pinned chats are separate from Recent and persist across refresh; the first-level
avatar menu contains Settings and About. Avatar, appearance and memory controls
remain available inside Settings.

Memory stays on this device. Explicit remember/correct/forget commands operate on
the current input; automatic capture is optional and defaults off for new settings.
Disabling recall preserves saved rows, while deleting a memory removes it from
future recall without rewriting earlier messages. No past-chat scan or cloud
memory extraction is performed. See [shell contract](docs/ROUND7-SHELL.md) and
[memory contract and limitations](docs/ROUND7-MEMORY.md).

APP-03 crash recovery uses a shared generation ownership protocol. Read [the protocol and coordinated upgrade requirements](docs/APP03_RECOVERY.md) before any deployment; legacy active rows are never automatically adopted or cleared.
