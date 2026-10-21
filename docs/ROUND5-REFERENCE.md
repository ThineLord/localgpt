# Round 5 measured UI scope

Signed-in Safari, 2026-10-21. Only UI geometry/styles were retained; images and
private conversation content are not reference material. Raw evidence stays local.

Observed at viewport1009×498 while Inspector was docked:
- Rail52, Home36×36 at8,8, radius10.
- Main starts x52, spans957, dark background rgb(14,14,14), foreground237;
  `clip-path:inset(0px round 16px)`, radius property0. Clip-radius transition150ms,
  cubic-bezier(.19,1,.22,1).
- Temporary sidebar allocation x52,width288. Actual floating surface x56,y4,
  width284,height490, radius14, overflowhidden, dark background33. Shadow:
  rgba(255,255,255,.05) 0 0 0 .5px inset, rgba(0,0,0,.05) 0 4px 16px.
  Sidebar ancestor z40; main geometry unchanged. Toggle36px at294,12, opacity1.
- Actual gallery reference is Space → Images, distinct from chat image output.
  Main content inset48px; first cardx100,y153,width203.25. Four columns in861px,
  gap16. Original aspect ratios retained, object-fit:contain; no square crop.
  Cardradius16, subtle1pxborder, darksurface33, shadow0 4px16px rgba(0,0,0,.05).
  CSS container breakpoints show1/2/3/4/5/6columns; exact breakpoint widths require
  further measurement. Do not label inferred thresholds as measured.

Implementation boundary: preserve all backend protocols, model settings, drafts,
Memory and Round4 data lifecycle. Codex owns shell/scroll/sidebar/header/tokens,
application adapters and final visual/function acceptance. One optional Cloud
module owns only new gallery-ui.js/gallery-ui.css and its synthetic harness.
No private screenshots, media, database, credentials or local paths go to Cloud.
