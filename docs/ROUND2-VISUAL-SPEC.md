# Round 2: observed interface and implementation contract

## Evidence and limits

2026-10-21: Codex inspected the user's signed-in ChatGPT in Safari, using an
empty temporary chat and a newly generated synthetic conversation. Existing
private conversations are excluded. Local-only captures cover temporary chat,
model/effort popup, attachment menu, settings General, Appearance light/dark,
and a synthetic message/code response. No reference images belong in Git.

The observed product differs from the first round's guest page: a narrow app
rail, a single-row empty composer, a wide attachment menu, and a **full-page
settings interface**, not the old modal. Do not reproduce unrelated Space,
Scheduled, Plugins, billing, account, or cloud controls.

Reference viewport is approximately 1443×995 CSS pixels, 100% Safari zoom,
native 2× capture, with browser chrome removed and profile avatar masked.
1440×900, 1280×800 and 390×844 are required HanzAgent acceptance sizes.
The user subsequently approved temporarily enabling Safari's web developer
features. Through its visible Console, Codex read DOM geometry and computed
styles from the synthetic temporary conversation. Responsive Design Mode
confirms 1440×900 CSS pixels. Its preview scales to 97% to fit the physical
window; screenshot normalization must disclose that resampling. 1280×800
and 390×844 preview at 100%. A clean expanded chat-history reference remains
a gap; private chat titles must never appear in delivered captures.
Never label guessed or interpolated values as observed measurements.

## Measured geometry and palette

| Surface | Observed reference | Current baseline issue | Target |
|---|---|---|---|
| Collapsed app rail | 52px; ~40px icon hit areas | 64px collapsed sidebar, hidden navigation | 52px persistent compact rail with functional history, new chat, gallery, settings |
| Empty composer | 768px wide, 52px high, 26px radius | multi-row toolbar/textarea, 3 separate setting controls | one row: plus, flexible textarea, compact model/mode trigger, send circle |
| Composer buttons | 36px send, 36–40px others; ~20px glyphs | mixed sizes and text-heavy controls | uniform 20px SVG/1.6–1.8 stroke; 36px desktop/44px mobile hit area |
| Empty main cluster | horizontally centered in area excluding rail; heading ~24px, regular | two-line promotional heading and suggestions | one calm line; remove suggestion cards; use visual center near 40% viewport height |
| Composer attachment popup | same 768px width, 8px gap, 20px corners, rows ~36px | immediate upload plus separate settings details | one real action menu: upload reference, image mode, generation controls |
| Model popup | compact ~254px width, 16px corners, anchored to model trigger | browser-native selects displayed inline | custom listbox/popover backed by existing native selects and change events |
| Settings | persistent rail + 288px section nav; main content ~728px; rounded grouped rows | 460px modal with loose icons and unrelated links | full-viewport settings surface with General, Appearance, Models & generation, Memory, Trash; only real functions |
| Main dark canvas | sampled #0e0e0e | gray legacy surfaces | #0e0e0e |
| Dark rail | #000000 | #171717 | #000000 |
| Dark composer/menu | #212121; hovered row ~#373737 | several inconsistent surface tokens | consolidated surface tokens |
| Dark text | account Appearance reports #ededed | close but not coherent | #ededed; secondary #a3a3a3 |
| Light base/text | account Appearance reports #fcfcfc / #0d0d0d | first round close | preserve these, neutral borders and hover |

Font: signed-in computed style, independently corroborated by a guest page:
`-apple-system-body, ui-sans-serif, -apple-system, system-ui, Segoe UI,
Helvetica, Apple Color Emoji, Arial, sans-serif, Segoe UI Emoji, Segoe UI Symbol`.
The guest heading "Where should we begin?" measures 255.047px at 24px/28px,
weight400; this particular text measurement is not a signed-in measurement.
Use this lawful installed-system approach, with PingFang SC / Microsoft YaHei
Chinese fallback; compare actual text widths and line wraps in acceptance.
Composer editable: verified 16px/26px with 5px vertical padding. Desktop outer
composer: verified x362, y824.203, 768×52, radius26, rgb(33,33,33) at1440×900.
Code: verified 12px/20px monospace. Body16px/1.6; menu/nav14px/20px;
small text12px/18px; headings24px/28px regular.
No downloaded proprietary font. One custom SVG system, no emoji or Unicode
substitutes for icons.

## Information architecture

1. Rail: home/history toggle, new chat, gallery, bottom settings. Expanded
   history is an adjacent panel; collapsed rail retains useful navigation.
2. Chat header: concise title; a single overflow menu for rename/delete.
   Each history item has an overflow menu, not a permanent trash button.
3. Composer: all existing native selects remain in DOM as backing state but
   are visually represented by custom controls. Mode auto/chat/image remains
   explicit. Attachment menu contains upload reference and switch-to-image.
   Generation parameters belong in a dedicated compact panel/settings section.
   Input grows on wrapping; send and stop occupy the same right-hand circle.
   Verified mobile reference at390×844: x16, width358, height~88, radius28,
   two rows (textarea above, plus/send below), fixed bottom with~64px below.
   The empty heading stays near y318; the composer does not follow it.
   The attachment menu is also358px wide, anchored above the composer.
4. Settings: full-page layered surface (existing dialog can remain semantic
   modal for focus/inert handling), left section navigation and right grouped
   rows. Verified mobile: top bar, content padding20, sidebar toggle opens a
   ~332px drawer (52px rail +280px section list), no compressed columns.
   Memory stays server-backed, accessible from Personalization/Memory.
   Trash remains soft-delete/restore with clear return path.
5. Gallery: image-first responsive grid, search, consistent preview surface;
   existing edit/download/open-chat/delete flows are preserved.
6. Message actions: icon buttons with accessible labels/tooltips. Preserve
   copy, retry, edit/resend, remember, download. User bubble right aligned;
   assistant content unboxed, code blocks with restrained header/copy.
7. Confirmation/rename: consistent 440px dialog, 24px padding, 20px radius,
   clear focus/disabled/error states, same button system.

## Ownership and contract

Cursor owns `work/chat-sidebar/studio.css`, `template.html`, new `ui-shell.js`,
and minimal build.py integration of that script. It may regenerate index.html.
Codex owns app.js, workspace.js, liquid-layers.js compatibility, tests, real
services, screenshots, deployment and integration. Do not edit each other's
files without an explicit handoff.

Preserve ALL existing element IDs, input option values, form submissions,
event handlers, aria relationships, and server routes. New controls must
dispatch input/change on backing selects; never replace a select's business
handler. Preserve dynamic model options, disabled/hidden states, and languages.
Do not delete features or merely hide their only functional entry point.
Use observers only when needed to synchronize existing dynamic UI state.
Do not duplicate request/streaming/history/memory logic in ui-shell.js.

CSS must be a coherent rewrite with tokens and component sections, not a new
layer of overrides. Existing atelier/liquid CSS are intentionally inactive;
no glass, blur, gradients, ornaments, decorative dashboards or fake buttons.
Build script order: app -> workspace -> liquid layers -> atelier -> ui-shell.

## Acceptance and merge gate

- Build/check, source audit, existing Python tests; no private data fixtures.
- Real browser capture for empty/chat/stream/image/gallery/model/attachment/
  generation/settings/appearance/memory/rename/confirmation/history menus.
- 1440×900, 1280×800, 390×844, light/dark and reference-sized 1443×995.
- Outside click, Escape, keyboard navigation, focus return, disabled state,
  mobile drawer inert/focus, textarea wrap, long scrolling and pinned composer.
- Codex must inspect screenshots, document P0/P1/P2 deltas, and verify real local
  chat/image services before sending exact commit acceptance to Mason.
- A green test suite or Cursor self-report is not visual acceptance.
- Independent branch/PR only. No force push, default-branch push, merge,
  credentials, user data, paid resources or permission changes by Cursor.
