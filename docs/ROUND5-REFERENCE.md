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

Additional rendered measurements (same signed-in Safari session):
- 1440×900 Images: main x52,width1388; gallery x100,width1292; six columns,
  each202px with16px gaps. Screenshot captured in responsive mode at66%/2x;
  the local image is marked scaled, not claimed to be a 1:1 screenshot.
- Light surface#fcfcfc, elevated#fff, rail/frame layer#f9f9f9;
  text#0d0d0d, secondary#5d5d5d, tertiary#8f8f8f;
  border#0000001a, subtle#0000000d.
- Dark surface#0e0e0e, elevated#212121; text#ededed, secondary#cdcdcd,
  tertiary#afafaf; border#ffffff26, subtle#ffffff0d. Dark frame#000 carries
  forward the Round4 reference; not independently remeasured this round.
- Tooltip CSS tokens: background#0d0d0d, textwhite, radius1rem,
  shadow0 8px18px #0f172a33. Actual tooltip timing/placement was not accessible
  through native pointer movement. HanzAgent uses an explicit approximation:
  350ms mouse delay, immediate keyboard focus,8px gap,12/18px text.
- Gallery detail is a main-surface viewer,52px toolbar,36px circular close;
  HanzAgent keeps its download/reference/chat/trash actions and omits unsupported
  sharing. Gallery tabs for separate upload collections are likewise omitted.
- Scrollbar width/hover opacity could not be independently measured in the
  reference. Native thin scrollbars with22%/34% foreground alpha are an accessible
  approximation. Scroll viewport placement is verified directly in HanzAgent.

Reference collection finished with Safari developer features restored OFF,
responsive mode exited, and the dedicated reference tab closed. No account theme
preference was changed (temporary DOM-only light-theme inspection was restored).
