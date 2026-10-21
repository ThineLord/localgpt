# LocalGPT Round 7 — Application Shell (Role A)

## Navigation contract

- **Single rail:** `#sidebar .app-rail` is the only application navigation rail. Settings no longer renders a duplicate `.settings-rail`.
- **Settings surface:** `#preferencesDialog` is positioned on the main surface (`inset: 0 0 0 var(--main-inset)`), sharing clip tokens with chat/gallery (`--main-clip`, `--canvas`, `--sidebar`).
- **AppShell API** (`app-shell.js`, `window.AppShell`):
  - `openSettings(section?, origin?)` — opens settings and optionally selects a tab (`general`, `profile`, `appearance`, `memory`, `about`, …).
  - `closeSettings()` — closes the settings dialog.
  `leaveSettingsForNavigation()` — closes settings before chat/gallery navigation.
  - `openMemory(origin?)` — registered from `workspace.js`; opens the Memory nested dialog without duplicating rail chrome.
  - Event `appshell-settings-section` — detail is the settings section id; `ui-shell.js` listens and activates the tab.

Role B should call `AppShell.openSettings('memory')` or `AppShell.openMemory(button)` instead of building a second rail.

## Pin metadata API

| Method | Path | Body | Response |
|--------|------|------|----------|
| `GET` | `/qwen-cn/chats` | — | Each chat includes `pinned` (bool) and `pin_version` (int, default 0). |
| `GET` | `/qwen-cn/chats/{id}` | — | Same fields on the chat object. |
| `PATCH` | `/qwen-cn/chats/{id}/pin` | `{ "pinned": boolean, "pin_version": int }` | `{ "chat_id", "pinned", "pin_version" }` |

- Optimistic concurrency on `pin_version`; stale body → **409**.
- Does **not** increment `chat.version` / `draft_version`.
- Table `chat_pin` is created on store open; existing chats stay unpinned until pinned.
- Trash excludes pinned chats from the active list; restore preserves pin state; permanent purge cascades via FK.

## Validation

```bash
python3 work/chat-sidebar/build.py
python3 -m unittest work/chat-sidebar/test_history_pin.py work/chat-sidebar/test_chats.py -v
python3 tools/round5_demo.py --port 8194
# Playwright: tools/round7_shell_acceptance.js
```

Screenshots: `output/playwright/round7/` (not committed).
