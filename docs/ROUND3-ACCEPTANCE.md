# Round 3: measured component corrections

Baseline: f071380. This is a bounded refinement, not a new UI architecture.
Reference images and real-service receipts remain in ignored local output.

| Component | Observed reference | Previous | Candidate |
|---|---|---|---|
| Rail buttons | Safari DOM x8, y8/60/112, 36×36, radius10, SVG slot20 | 40px controls, 42px rhythm | 36px controls, 52px rhythm |
| Pinned desktop panel | Safari DOM x52, width288 | combined width332 | combined width340 |
| Attachment anchor | reused signed-in capture, 4px gap | 8px | 4px |
| Attachment first row | panel inset8, icon inset8, label x410 at1440 | label x413, no focused surface | x410, dark #383838; readable light token |
| General settings first card | reused capture y97 ±1 | y108 | y96 |
| Theme preview spacing | reused mobile capture x37/133/229 | x37/129/221 | x37/133/229 |
| Theme selection outline | on preview boundary | offset3 outside | offset−2 inside |
| Settings selected row | reused dark capture #262626 | #373737 | #262626 |
| Ordinary new conversation | live New chat navigates to `/`, empty composer | immediately inserted an empty DB row | empty root state; create on draft editing/send |

Safari's current native viewport and responsive preview are distinct: requested
1440×900 returned DOM innerWidth1438/innerHeight899 in this small window. Fixed
rail/panel values above were read from rendered elements, not inferred from
preview scaling. The earlier 14 reference pairs remain the visual comparison
source. A small original vertical paperclip replaces the incorrect plus; its
shape is an approximation, not a copied proprietary SVG.

The existing server draft protocol remains unchanged. The first edited draft
materializes a record and uses the existing version/conflict flow. A per-tab
sessionStorage recovery copy covers a failed initial save/reload; it is removed
after a successful save. This is deliberately different from ChatGPT's possible
send-only history creation, to preserve HanzAgent's durable local drafts.
No existing chat is deleted. Root loads a blank page; explicit #chat routes still
load saved conversations. Empty clicks no longer create database clutter.

Local browser evidence: attachment dark/light desktop/mobile, General and
Appearance at1440×900/1280×800/390×844, rail collapsed/expanded, draft lifecycle,
existing synthetic interaction matrix. English Memory/Mode labels are corrected.
Tests include a simulated write failure, reload recovery and sending after recovery.

## Explicit remaining differences

- Rail navigation retains local New chat/Gallery/Settings and HanzAgent identity.
- Sidebar remains click-to-pin; a Safari Home temporary panel was observed, but
  its hover timing and pointer dismissal were not measured reliably. No invented
  timing constants or claim of exact hover reproduction.
- Model choices are actual local model/mode options. The prior reference called
  “model” is an effort slider and is not evidence for a model list's geometry.
- History popup, Memory contents, and every nested settings state are not claimed
  pixel-identical. No private conversation or memory content is used as test data.
- Browser settings were restored: developer features verified off. Appearance
  was not changed this round. One UI-only measurement snippet was accidentally
  entered into a new test chat due to inspector focus drift; it contained no
  private data. Subsequent console submissions required a focus check.

## Collaboration and release gate

Cursor via Axel produced attachment commit5b118c6 in draft PR6, targeting the
integration branch. Codex corrected light-theme focus and icon geometry, and owns
settings, rail and draft-state changes. Parent cloud task:
`bc-7bd7440a-b2bf-56ff-b0e3-4625b07c90f1`, requested `gpt-5.4-mini`,
`reasoning=medium`; actual other parameters and cost unavailable.
Two unexpected child tasks were detected and stopped/finished; no further Cloud
runs were created. The Solo restriction was reiterated. Full receipts are local.

Mason must independently review the integration PR. Merge requires Codex's
exact-head local acceptance, including real chat/image verification. No CI is
configured; local tests are the alternative evidence. Production remains the
previous baseline until that gate is satisfied.
