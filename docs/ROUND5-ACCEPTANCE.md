# Round 5 acceptance

Scope: frontend only; runtime/storage/model/deletion protocols are unchanged.
Reference parameters and explicit approximations are in ROUND5-REFERENCE.md.

- Full-width scroll viewport: at1440/1280/390, its right edge equals the viewport
  edge; message/composer columns stay centered. Six viewport/theme combinations
  checked in a real browser. Header conversation/model labels removed; model
  selection remains in the composer. Browser tab titles remain descriptive.
- Rail52; temporary panel x56,y4,w284,h(viewport−8),radius14; main clip16;
  Home hover immediately reveals Toggle. Gap crossing, pointer dismissal,
  pin/unpin, outside click, Escape, mobile overlay/inert/focus verified.
- Custom top-layer tooltips replace native title bubbles on navigation controls.
  Main/header layering and mobile text overlap corrected. Jump-to-bottom uses
  the actual composer height; streaming jumps are immediate so subsequent
  renders cannot interrupt a smooth-scroll animation.
- Gallery6/5/1 columns at1440/1280/390 collapsed layouts; original ratios,
 16/12px gaps,16px cardradius. Masonry and natural ratio fallback tested in the
  integrated app and standalone Cloud harness. Viewer fills the main surface;
  download, focus return, image information and existing actions retained.
- Small logo: original path/cut retained; viewBox tightened and stroke1.65→1.85.
- Synthetic tests: streaming partial/follow/manual review/jump; repeated refresh,
  database/offline error differentiation/retry; empty new-chat behavior; draft
  restore/conflicts; Settings/Memory; gallery trash/restore/permanent deletion,
  shared-file guard and upload reference guard. No real data deletion.
- Actual LM Studio qwen3-8b: completed the synthetic exact-sentence prompt,
  5 SSE events with partial output, persisted and reloaded successfully.
  Existing Round4 synthetic ComfyUI output retrieved HTTP200; no new image
  inference was needed because its execution pipeline was untouched.
- Read-only row comparison: every pre-existing row remained byte-equivalent;
  only one new synthetic chat/message was added by the real LM test.

Evidence is local under ignored output/playwright/round5 and output/acceptance/
round5, including reference geometry, before/after screens and visual-review.html.
Reference images do not contain private image pixels or conversation bodies.
No pixel-perfect equivalence is claimed for native scrollbars, tooltip timing,
container breakpoints or cross-browser font rasterization.

Cloud: bc-f3788acc-8c0a-5a39-8c7d-87e6eb3cbe41, composer-2.5, fast=false;
no separate reasoning parameter; actual usage/cost unavailable. PR10 is module
provenance. Codex rejected its first grid implementation, requested a same-task
revision, fetched the resulting commits, then integrated and corrected sizing,
breakpoints and layout scheduling locally. Final independent review belongs to
the integrated PR, not the Cloud self-report.

Reproduce synthetic fixtures: build the frontend, run tools/round5_demo.py
--port8194, then execute the round5 shell/gallery/scroll Playwright functions.
The standalone gallery harness requires a locally available Playwright package.

GitHub automated review found inherited pointer-events disabling the header menu.
The menu now explicitly accepts pointer events; mouse rename persistence and
mouse/touch soft deletion and undo plus touch rename are covered by
round5_header_actions_acceptance.js. A separate Chrome run with Playwright's
scrollbar-hiding launch flag removed verified the native thin scrollbar is
visible at the far right and can be dragged (scrollTop advanced to1406).

Final empty-state comparison caught the removed header moving the composition
52px upward. Empty-state padding now preserves the prior anchor: desktop composer
y378 at1440×900 andy338 at1280×800; mobile composer remainsy692 at390×844.
Six viewport/theme checks pass without restoring the visible header title.
