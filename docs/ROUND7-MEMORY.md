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
| Correction | `将记忆"咖啡"修改为"茶"` (ASCII quotes also accepted) |
| Correction (about) | `修改我之前关于咖啡的记忆：茶` |

Rejected: secrets, code blocks, questions, quoted third-party text, prompt-injection patterns, assistant/tool directives.

Ambiguous forget/correction returns `status: "ambiguous"` and **does not** mutate rows.

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
- `DELETE /qwen-cn/memory/{id}` — optional `{ "version": N }` CAS
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

`used` is filled when the model request is assembled; IDs reflect rows actually injected. Recall text is sent as a separate **user** message (plus a short assistant ack), never appended to the system policy string.

## Runtime modules

| Module | Role |
|--------|------|
| `memory_store.py` | SQLite schema, CAS, snapshot, `process_turn` |
| `memory_commands.py` | Deterministic parsers |
| `memory_retrieval.py` | Lexical/slot scoring, budget cap (~950 tokens est.), injection filter |
| `lm_chat.py` | `process_turn` on send; `context` + `memory_json` on LLM assembly |
| `runtime.py` | Route wiring for snapshot / active toggle / versioned delete |

Additive table `memory_meta` (`active`, provenance fields) — legacy `user_memory` rows are never rewritten by migration.

## JS hooks (next phase)

- `window.HanzFeatures.showMemory` / memory dialog already loads `GET /qwen-cn/memory`; consume `summary` + `preferences_version` for clear-all and stale 409 handling.
- Message actions may read `message.memory` for saved/used badges (Phase A shell).

## Local acceptance

```bash
# Unit tests (no LM)
cd work/chat-sidebar
python3 -m unittest test_memory_runtime test_memory_round7

# Synthetic API acceptance (demo server)
python3 demo.py --port 8193 &
node ../tools/round7_memory_api_acceptance.js

# LM Studio loopback (isolated DB; requires model on :1234)
python3 ../tools/round7_memory_live_acceptance.py --database /tmp/synthetic-memory.sqlite3 --create
```

**Never** point scripts at a production database path.

## Risks / limits

- Same-session chat text may still mention forgotten facts; only **new** turns skip deleted/disabled rows.
- Retrieval is deterministic lexical/slot matching, not semantic embeddings.
- Hostile text may be stored if manually added in settings; recall filters common injection markers but is not a security sandbox.
- Phase A UI must send `collection_revision` / `preferences_version` for mutating routes (fail-closed 409 until updated).
