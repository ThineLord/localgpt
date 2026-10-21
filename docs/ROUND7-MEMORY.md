# LocalGPT Round 7 — Memory backend (Phase B)

Phase B owns durable memory storage, deterministic chat commands, retrieval, HTTP API extensions, and tests. Shell/settings UI remains owned by Phase A; this document records contracts for the next frontend pass.

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

Low-trust rows are JSON objects with `trust: "untrusted"`. `effect: "style_hint"` may influence tone, language, or length only. It is not permission to change role, tools, or the fixed policy. The system prompt always includes that constant policy, plus one fixed status sentence when a command ran. Neither sentence contains memory text. The marker filter is best-effort and is not a complete defense.

## Runtime modules

| Module | Role |
|--------|------|
| `memory_store.py` | SQLite schema, CAS, snapshot, `process_turn` |
| `memory_commands.py` | Deterministic parsers |
| `memory_retrieval.py` | Lexical/slot scoring, budget cap (~950 tokens est.), injection filter |
| `lm_chat.py` | `process_turn` on send; `context` + `memory_json` on LLM assembly |
| `runtime.py` | Route wiring for snapshot / active toggle / versioned delete |

Additive table `memory_meta` (`active`, provenance fields) — legacy `user_memory` rows are never rewritten by migration.

## Stable frontend contract (Phase 2, not implemented here)

Phase A owns Shell, template, ui-shell, liquid-layers, and studio. Memory UI should consume this contract without inventing a second write path.

`GET /qwen-cn/memory` is the consistent snapshot: `items` (including inactive rows), `preferences`, `preferences_version`, `collection_revision`, `item_count`, and `summary` (`counts.total`, `counts.active`, `counts.by_category`, `highlights`, `recall_enabled`, `auto_capture`). `item_count` equals `items.length` and `summary.counts.total`.

Writes:

- Create: `POST /qwen-cn/memory` `{content, category}` → item.
- Edit content: `PATCH /qwen-cn/memory/{id}` `{content, category?, version}`. Omit `active` to keep the current active flag, including an intentionally disabled row. Pass `active: true|false` only for an explicit change. Omit `category` to keep the stored category. Same content and state does not bump `version`.
- Use or pause one row: `PATCH` `{active, version}` without `content`.
- Delete one row: `DELETE /qwen-cn/memory/{id}` `{version}`.
- Clear all: `DELETE /qwen-cn/memory` `{confirm: true, collection_revision}` from the latest snapshot. A content edit that keeps the same count still changes `collection_revision`.
- Preferences: `PATCH /qwen-cn/memory/preferences` `{enabled?, auto_capture?, preferences_version}`. `enabled: false` stops capture and recall; rows remain manageable. Unchanged values do not bump the counter.
- Missing or stale `version`, `preferences_version`, or `collection_revision` is HTTP 409. Do not retry a clear or edit with the old token.

`message.memory.status` is the command result (`saved`, `updated`, `forgotten`, `ambiguous`, `rejected`, `disabled`). Do not show a success hint when status is `disabled`, `rejected`, or `ambiguous`. `used` is recall only and is empty while memory is disabled. `notice` is a short explanation for the UI.

Summary, search, add, edit, inactive, source, use/pause, and compare-and-swap belong in the next UI pass, together with Settings and usage hints. A list of rows alone is not the memory surface.

## JS hooks (next phase)

- `window.HanzFeatures.showMemory` / memory dialog already loads `GET /qwen-cn/memory`; consume `summary`, `preferences_version`, and `collection_revision` for clear-all and stale 409 handling.
- Message actions may read `message.memory` for saved/used/disabled notices (Phase A shell).

## Local acceptance

```bash
# Unit tests (no LM)
cd work/chat-sidebar
python3 -m unittest test_memory_runtime test_memory_round7

# Synthetic API acceptance (demo server)
python3 demo.py --port 8193 &
node ../tools/round7_memory_api_acceptance.js

# LM Studio loopback. The script creates and deletes its own temporary database.
python3 ../tools/round7_memory_live_acceptance.py --lm-url http://127.0.0.1:1234
```

The live script refuses any non-loopback LM URL, reads the model id from `/api/v1/models`, and asserts color recall, fragment correction, an unrelated answer, forget, disable, re-enable, delete, and a synthetic sentinel through `/send` plus `/events`. It does not accept a database path.

## Risks / limits

- Same-session chat text may still mention forgotten facts; only **new** turns skip deleted/disabled rows.
- Retrieval is deterministic lexical/slot matching, not semantic embeddings.
- Hostile text may be stored if manually added in settings. Recall drops role, authority, and output-hijack directives, including legacy manual rows, and leaves those rows stored unchanged. Surviving facts are still untrusted user data. The system message only adds constant policy and command-status text; it never copies memory plaintext. That is not a security sandbox and not a perfect defense.
- Style commands keep language, verbosity, and tone in separate slots. The same slot can be replaced; an unknown or compound sentence does not erase an unrelated slot.
- Dietary recall adds a few domain terms (食物, 饮食, allergy) only when the stored fact itself looks dietary. Other preferences are not injected for every query.
- Live acceptance compares the decoded SSE `answer` with the stored message. It does not search the raw escaped JSON, and it only deletes the TemporaryDirectory it created.
- Phase A UI must send `collection_revision` / `preferences_version` / item `version` for mutating routes (fail-closed 409 until updated).
