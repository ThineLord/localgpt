# Verified architecture and ownership

- `template.html` + `studio.css`, `atelier.css`, `liquid-layers.css`, `app.js`, `workspace.js`, motion scripts -> `build.py` -> ignored/generated `index.html`.
- `serve.py` binds 127.0.0.1:8190, serves workspace HTML, validates same-origin requests, discovers backend paths; forwards image endpoints/download/upload to existing ComfyUI 8188.
- `runtime.py` installs SQLite conversation/memory routes and local chat routing; ComfyUI owns queued image monitoring. Chat/routing ownership is coordinated with a sibling POSIX lock and additive SQLite ownership/recovery records; unknown legacy rows fail closed. See [recovery](APP03_RECOVERY.md).
- `lm_chat.py` calls LM Studio 1234 OpenAI-compatible streaming completion, captures chunks in SQLite; browser subscribes to `/qwen-cn/messages/{id}/events` via EventSource (SSE). Periodic refresh every 3 seconds reconciles state. Image backend observes ComfyUI WebSocket progress; frontend does not directly use WebSocket.
- `POST /qwen-cn/chats/{id}/send` accepts prompt, mode (auto/chat/image), model, thinking, temperature, max_tokens, cfg, seed, size, quality, reference and request_key. Returns persisted message; preserve idempotency and concurrent-draft conflict checks.
- Chat CRUD/drafts: `/qwen-cn/chats`, `/qwen-cn/chats/{id}`, `/{id}/draft`, `/{id}/restore`. Trash/gallery/memory and model endpoints are implemented, not decorative UI.
- Images remain files in configured ComfyUI input/output directories. SQLite contains reference descriptors, chat text, drafts, settings and memories. Legacy JSON and migration backups contain personal data. None belongs in Git or cloud contexts.
- `demo.py` is an explicit separate process with a fresh temporary database, simulated SSE and authored vector fixture. It replaces inference only inside that demo process. Never use demo tests as proof of real inference.

## Current ownership

Codex coordinates implementation, file organization and release preparation. Native subagents independently review and perform authorized merges. Do not invoke bots, external bridges or cloud agents. Follow [AGENTS.md](../AGENTS.md) and the [agent guide](agent-guide.md); older collaboration roles are historical only.
