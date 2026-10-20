# HanzAgent

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

Start your existing ComfyUI instance with the HanzAgent extension on loopback port 8188 and LM Studio on 1234. Then run `.venv/bin/python work/chat-sidebar/serve.py` and open http://127.0.0.1:8190/qwen-cn/ . The server discovers the existing database and image output location from `/qwen-cn/health`. It preserves existing data. The backend extension source is `backend.py` (installed as `__init__.py`) with `storage.py`, `lm_chat.py`, `generation.py` and built `index.html`; installation and model acquisition are explicit local setup tasks, not performed by the demo.

Image inference requires the existing ComfyUI nodes and model files named in `generation.py`: Qwen Image 2.1 GGUF, its Qwen3-VL encoder and VAE, UnetLoaderGGUF, TextEncodeQwenImage21 and QwenImage21Cache. Models are not distributed. Chat uses locally installed LM Studio models (default qwen3-8b), `/v1/chat/completions` streaming, and its `lms` executable. The app only unloads LM Studio instances it owns. Do not change model names or settings to make UI tests pass.

Features: automatic/chat/image mode, model selection, streamed answers, stop/retry/edit/copy, image reference upload/edit/download, draft persistence and conflicts, conversation rename/trash/restore, gallery, explicit memory management, Chinese/English, light/dark/system appearance. Markdown is intentionally a small escaped subset, not a full renderer.

## Validation

```sh
python work/chat-sidebar/build.py --check
node --check work/chat-sidebar/app.js
node --check work/chat-sidebar/workspace.js
python -m unittest discover -s work/chat-sidebar -p 'test_*.py' -v
```

## Privacy

This repository contains reviewed source only. Original workspaces, history, databases, generated images, references, logs, screenshots, recordings, backups, secrets and credentials are excluded. Never `git add` an application data directory. Do not copy local `.git` objects or checkpoints into this repository. Browser preferences may be in localStorage; chat drafts/messages/memories are in the discovered SQLite database, legacy imports in `qwen-studio-history.json`, uploads/output in ComfyUI's configured directories. Migration backups remain local. Existing runtime configuration is not uploaded or overwritten.

Run `python tools/audit_source.py` after staging and before committing. It checks staged file names/content and prints no secret values. A passing pattern scan supplements human review; it cannot prove arbitrary text contains no private information.
