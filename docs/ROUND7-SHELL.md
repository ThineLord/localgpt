# LocalGPT Round 7 — Application Shell (Role A)

## Navigation contract

- **Single rail:** `#sidebar .app-rail` is the only application navigation rail. Settings no longer renders a duplicate `.settings-rail`.
- **Settings surface:** `#preferencesDialog` is a page layer on the main surface (`inset: 0 0 0 var(--main-inset)`), opened with `dialog.show()` so the shared rail stays active. It is not a modal. Nested Memory and confirm dialogs stay modal. The same `#sidebar .app-rail` node is used on every page.
- **Corners:** collapsed/temporary clip is `inset(0 round 16px)`. Pinned radius is `0 16px 0 0` (square left, 16px top-right, square bottom-right). Mobile is square. Temporary sidebar does not change `--main-inset`.
- **AppShell API** (`app-shell.js`, `window.AppShell`):
  - `openSettings(section?, origin?)` — opens the settings page and optionally selects a tab (`general`, `profile`, `appearance`, `memory`, `about`, …).
  - `closeSettings()` — returns a Promise that resolves after the page is closed and focus is restored.
  - `leaveSettingsForNavigation()` — returns that same close Promise; chat/gallery navigation awaits it.
  - `registerOpenMemory(fn)` — registers the Memory opener. `workspace.js` may call this, or assign `window.AppShellRegistrations.openMemory`, before `app-shell.js` runs.
  - `openMemory(origin?)` — opens the registered Memory dialog without duplicating rail chrome.
  - Event `appshell-settings-section` — detail is the settings section id; the shell activates that tab.
  - Event `appshell-surface` — sidebar sync reads settings-open state from this signal.

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
