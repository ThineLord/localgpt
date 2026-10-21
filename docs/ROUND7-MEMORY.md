# LocalGPT Round 7 — Memory

Phase B owns durable memory storage, deterministic chat commands, retrieval, the memory HTTP API, memory tests, and the memory settings and manager UI. The shared rail, settings shell, and pin/media stay with Phase A.

## Product alignment (public concepts only)

Inspired by [OpenAI Memory in ChatGPT](https://help.openai.com/en/articles/8590148-memory-in-chatgpt): saved memories are separate from chat history; disabling memory pauses recall/capture but does not erase chats; corrections and deletes affect future personalization, not past message text. LocalGPT does **not** implement cloud chat-history mining, vector databases, or proprietary ranking.

## Preferences

| Key | Default when absent | Meaning |
|-----|---------------------|---------|
| `enabled` | `true` | When `false`, no recall and no chat capture; settings UI may still manage rows. |
| `auto_capture` | `false` | When `true` and `enabled`, first-person statements in the **current turn** may be stored. Explicit `记住` / `remember` works even when `auto_capture` is `false`. |

Existing rows in `memory_preferences` keep their stored values. `preferences_version` increments on preference changes and guarded clear-all.

## Supported chat commands (current user turn only)

| Intent | Examples |
|--------|----------|
| Explicit save | `记住：…`, `remember: …` |
| Style preference | `以后回答时请简洁。`, `Going forward, please answer in English.` |
| Forget | `忘记：项目 Alpha`, `forget: coffee preference` |
| Correction (fragment) | `将记忆"钴蓝色"修改为"琥珀色"`；`correct memory "tea" to "coffee"` |
| Correction (full fact) | `修改我之前关于颜色的记忆：用户最喜欢的颜色是琥珀色`；`correct my memory about color: My favorite color is amber.` |

Rejected: secrets, code blocks, questions, quoted third-party text, prompt-injection patterns, assistant/tool directives.

Fragment correction replaces one occurrence inside the stored fact and keeps the rest (`用户最喜欢的颜色是钴蓝色。` → `用户最喜欢的颜色是琥珀色。`). If the fragment is missing or repeats, the row is left unchanged. The broader “修改我之前关于…的记忆” / `correct my memory about …` form replaces that one fact with the supplied text.

Ambiguous forget/correction returns `status: "ambiguous"` and **does not** mutate rows. A disabled memory returns `status: "disabled"` with empty `saved` / `updated` / `forgotten`; the model is told only a fixed status sentence, not that the command succeeded.

Editing content preserves `active` unless `active` is sent as an explicit boolean. Repeating the same fact does not bump `version` or `collection_revision`. A same-count content or provenance edit does bump `collection_revision`, so a clear that still holds the previous revision fails. `GET /qwen-cn/memory` reads items, preferences, and both counters in one transaction. Opening the store adds tables and revision triggers only; it does not rewrite legacy `user_memory` rows.

## HTTP API

### `GET /qwen-cn/memory`

Returns:

```json
{
  "items": [ { "id", "content", "category", "topic", "source", "version", "active", ... } ],
  "preferences": { "enabled", "auto_capture" },
  "preferences_version": 1,
  "collection_revision": 1,
  "item_count": 0,
  "summary": {
    "counts": { "total", "active", "by_category" },
    "highlights": [ { "id", "category", "preview" } ],
    "recall_enabled": true,
    "auto_capture": false
  }
}
```

### Existing manage routes (unchanged callers)

- `POST /qwen-cn/memory` — manual create (`put`)
- `PATCH /qwen-cn/memory/{id}` — edit content **or** `{ "active": false, "version": N }` toggle
- `DELETE /qwen-cn/memory/{id}` — `{ "version": N }` required CAS
- `DELETE /qwen-cn/memory` — `{ "confirm": true, "collection_revision": N }` (required; from last `GET`)
- `PATCH /qwen-cn/memory/preferences` — `{ "enabled" | "auto_capture", "preferences_version": N }` (required CAS)
- `PATCH` / `DELETE` item — `version` required (409 if missing/stale)

### Chat message payload (`message.memory`)

After send / completion:

```json
{
  "saved": ["uuid"],
  "updated": [],
  "forgotten": [],
  "used": ["uuid"],
  "status": "saved|updated|forgotten|ambiguous|rejected|disabled",
  "notice": "optional human-readable reason"
}
```

`used` is filled when the model request is assembled; IDs reflect rows actually injected. `status: disabled|rejected|ambiguous` always has empty `saved`, `updated`, and `forgotten`. Recall text is a separate **user** message (plus a short assistant ack) carrying a fixed policy prefix. It is never a system message. The system message may gain one fixed sentence for the command status; that sentence does not include memory text.

Low-trust rows are JSON objects with `trust: "untrusted"`. `effect: "style_hint"` may influence tone, language, or length only. It is not permission to change role, tools, or the fixed policy. The marker filter is best-effort and is not a complete defense.

## Runtime modules

| Module | Role |
|--------|------|
| `memory_store.py` | SQLite schema, CAS, snapshot, `process_turn` |
| `memory_commands.py` | Deterministic parsers |
| `memory_retrieval.py` | Lexical/slot scoring, budget cap (~950 tokens est.), injection filter |
| `lm_chat.py` | `process_turn` on send; `context` + `memory_json` on LLM assembly |
| `runtime.py` | Route wiring for snapshot / active toggle / versioned delete |

Additive table `memory_meta` (`active`, provenance fields) — legacy `user_memory` rows are never rewritten by migration.

## Frontend (implemented)

Settings → 个性化 (`data-settings-section="memory"`, so `AppShell.openSettings('memory')` still selects it) holds the global `enabled` and `auto_capture` switches, the snapshot summary, and a link to the memory manager. The avatar menu stays Settings and About. Profile and Appearance stay inside Settings. The manager is `#memoryDialog` on the shared rail: summary, search, add, edit, per-row pause/resume, delete, and clear. A row shows its category, source, and a known topic when the snapshot has them. Pause, global off, and delete are separate controls. Global off keeps the rows and still allows management.

All of those actions call `/qwen-cn/memory`. Item writes send `version`. Preference writes send `preferences_version`. Clear sends `collection_revision` from the latest `GET`. A 409 leaves the editor text in place, explains the conflict, and offers reload. Reload does not copy the server text into the editor unless the user chooses “改用服务器上的内容”. Failed deletes and clears are not retried with a newer token.

`message.memory` is shown on the user turn by `memory-ui.js` (`HanzFeatures.renderActions`). `saved` / `updated` / `forgotten` are success hints. `disabled` / `rejected` / `ambiguous` are not. `used` is a count of ids actually injected on that turn, without printing the ids, and the hint says injection is not proof the answer relied on them. While memory is disabled, `used` is empty and the hint does not claim a save.

## JS hooks

- `window.HanzMemory.open(seed?, origin?)` opens the manager and returns focus through `LiquidLayers` to `origin`.
- `window.AppShell.openMemory(origin?)` uses the registration from `memory-ui.js`.
- `window.HanzFeatures.remember(message)` opens the editor with that prompt.
- `window.HanzFeatures.memorySignal(memory)` formats one message payload. `renderActions()` reads the open chat from the API and paints `.memory-turn-hint`.

## Local acceptance

```bash
python3 work/chat-sidebar/build.py
cd work/chat-sidebar && python3 -m unittest test_memory_runtime test_memory_round7

# Synthetic UI. demo.py uses a temporary database and does not call a model.
python3 work/chat-sidebar/demo.py --port 8196
node tools/round7_memory_ui_acceptance.js

# Optional synthetic API script against that same demo server.
node tools/round7_memory_api_acceptance.js http://127.0.0.1:8196

# LM Studio on this machine only. The script creates and deletes its own temporary database.
python3 tools/round7_memory_live_acceptance.py --lm-url http://127.0.0.1:1234
```

The UI script refuses a server whose `/qwen-cn/health` is not `demo: true`. It drives add, edit, search, pause, resume, delete, global off/on, 409 conflict, clear, refresh, message hints, and light/dark layouts at 1440×900, 1280×800, and 390×844.

The live script refuses any non-loopback LM URL, reads the model id from `/api/v1/models`, and asserts color recall, fragment correction, an unrelated answer, forget, disable, re-enable, delete, and a synthetic sentinel through `/send` plus `/events`. It does not accept a database path. Running it requires a local LM; a remote or cloud model is out of scope. The synthetic demo replaces model streaming, so it does not record `used` ids. The hint still renders them when a real turn payload includes `used`.

## Risks / limits

- Same-session chat text may still mention forgotten facts; only **new** turns skip deleted/disabled rows.
- Retrieval is deterministic lexical/slot matching, not semantic embeddings.
- Hostile text may be stored if manually added in settings. Recall drops some known injection markers and wraps the rest as untrusted user data under a fixed policy. That is not a security sandbox and not a perfect defense.
- The memory manager sends `collection_revision`, `preferences_version`, and item `version`. A stale token is a visible 409, not a second write.
- Synthetic demo answers are fixtures. They are not evidence that a local model used a memory.
