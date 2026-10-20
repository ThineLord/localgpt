# Round 2 visual and interaction acceptance

This round uses signed-in Safari observations of an empty temporary chat,
synthetic conversation, attachment/model popups, General and Appearance.
No existing private conversation, account memory or private image was used.
Screenshots, database receipts and model outputs are local-only, ignored by Git.

## Concrete comparison

| State | First-round baseline | Measured/observed target | Integration result |
|---|---|---|---|
| Collapsed rail | 64px | 52px | 52px |
| Empty desktop, 1440×900 | x370/y462, 768×96 | x362/y378, 768×52 | x362/y378, 768×52, radius26 |
| Populated desktop composer | multiple controls/rows | x362/y824.2, 768×52 | x362/y824, 768×52 |
| Empty mobile, 390×844 | x8/y391.5, 374×124 | x16/y692, 358×88 | x16/y692, 358×88, radius28, bottom64 |
| Settings desktop | centered 460px dialog | 52px rail +288px nav; 728px content at x526 | full-page structure; x526, width728 at1440 |
| Mobile Appearance | generic modal | section title in top bar; 20px side padding; first group y124 | same hierarchy and measured anchor; three real theme modes |
| Attachment | direct upload/separate toolbar | composer-width menu, 8px gap | unified real actions, same width/gap; mobile above whole composer |
| Model | exposed native select | compact ~254px popup | 254px menu backed by original selects; real mode/model choices |
| Typography | Arial-first, inconsistent controls | observed installed-system stack; input16/26, code12/20 | matched stack and sizes; actual Chinese font PingFang SC Regular |

A same-text Latin heading probe at 24px/28px/400 with normal spacing measures
253.516px in Chromium versus the observed Safari/guest 255.047px. An initial
negative letter spacing worsened this to244.719px and was removed. The remaining
~1.5px difference is documented, not concealed by downloading proprietary fonts.

`tools/round2_visual_matrix.js` captures 1440×900,1280×800,390×844 in both themes.
`tools/visual_report.py` creates a local report from explicit same-size pairs:
reference, baseline, update, 50% overlay and amplified difference. The report
contains21 states;14 have true reference pairs. Pixel differences are descriptive,
not an invented similarity/pass percentage. Safari's1440 responsive preview was
97% fit and normalized;1280/390 were100%. Cross-browser rasterization and different
synthetic text must be considered. Profile regions are masked.

## Behavior and preservation

`tools/round2_acceptance.js` runs against the isolated synthetic demo only. It
covers streaming, semantic Markdown/list/code, copy, edit, stop, retry, long drafts,
model/mode adapters, upload/removal, theme/system changes, memory save and
confirmation cancellation, image progress/result/download, gallery edit, rename,
soft deletion/undo, nested Escape/focus, mobile inert navigation and overflow.
The existing upload behavior intentionally selects image mode; removing a
reference does not silently change it back. The test was corrected to respect
that contract. No backend route, model credential or storage schema changed.

A separate preview proxy uses the current frontend with the existing real8190
backend. It creates one explicitly synthetic acceptance conversation, observes
real LM Studio streaming and tests the existing ComfyUI image path. The real chat completed with observed partial output. ComfyUI completed a new
512×512 image at15 steps/seed42; the browser decoded it, downloaded it, reused it
as an edit reference, and separately uploaded/decoded a synthetic1×1 PNG before
removing the reference. No additional reference-conditioned inference was run.
Real-service receipts remain local; exact-HEAD acceptance is supplied separately
to Mason. Original rows are checked by stable SQLite snapshot
and SHA256 of Python tuple repr; only new test records may be added.

The real image screenshot exposed delayed-decode scroll drift. The image stage
now reserves its recorded dimensions/aspect ratio before loading. The focused
`tools/round2_image_scroll.js` regression delays decoding: the pending image
already reserves512×512, completion leaves0px bottom gap, and manually scrolling
to the top stays at0px after decode. This test does not call a real model.

## Intentional differences and remaining reference gaps

- HanzAgent identity, local model/mode choices and generation parameters remain.
  No voice, temporary-chat guarantee, account, plugins, billing or fake controls
  were added. The reference effort slider is not misrepresented as a local feature.
- Settings includes only five useful sections. No search over a long list of
  nonexistent account settings. Theme previews are original CSS miniatures.
- Memory, gallery, rename and confirmation share the measured component system,
  but no reliable private-free equivalent ChatGPT reference was collected for
  every one of these states. They are not claimed as pixel-identical.
- A clean expanded ChatGPT history reference is missing because private titles
  were excluded. HanzAgent's expanded history remains independently tested.
- Native title tooltips and browser select option popups retain platform rendering;
  the surrounding controls and major menus use the shared component rules.
- Safari locked again during collection. Its temporary Light appearance and
  enabled web developer features require restoration after the user unlocks.
  Do not claim those settings have already been restored.

The first-round acceptance document is retained as historical evidence, not as
this round's visual standard. Code review and successful automated checks do not
replace inspecting the local comparison report and rendered states.
