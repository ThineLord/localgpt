# Historical browser scripts

These 25 scripts record earlier Round interfaces and acceptance assumptions. They are preserved unchanged for provenance, not run as current release acceptance. Several target removed controls or obsolete layout geometry; two image suites were blocked by the old SVG fixture and the memory suite exposed a real focus defect. Archiving a script does not establish a product pass.

Current entry: [tools/validate.py](../../validate.py). Current contracts live in [the browser suite](../../browser/README.md), use isolated per-case fixtures, pinned Chromium, current selectors, nonzero failure exits and machine-readable reports.

| Previous scripts | Current coverage |
| --- | --- |
| browser_acceptance; round2_acceptance; round3_state; round4_navigation; round7_shell | shell, navigation, sidebar, release-flows |
| round2_image_scroll; round5_scroll | scroll and gallery |
| round2_review_regressions; round3_attachment; round4_media | media, release-flows and backend upload/lifecycle tests |
| round2_visual_matrix; round5_empty_position | empty-layout, gallery, shell (1440/1280/390, light/dark) |
| round3_review_regressions | draft-conflicts |
| round4_language | language, release-flows |
| round4_memory; round7_memory_api; round7_memory_ui | memory-api, memory-ui and backend memory tests |
| round5_gallery_acceptance; round5_gallery_integration | gallery with actual production page/routes and PNG fixtures |
| round5_header_actions; round6_message_actions | chat-actions, release-flows and backend message tests |
| round5_shell; round6_navigation | shell, navigation |
| round6_avatar | avatar |
| round8_pinned_sidebar | sidebar |

Current coverage tests supported behavior rather than every historical pixel position or isolated mock DOM. Real inference is separate and is never implied by synthetic passes.
