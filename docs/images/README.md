# README screenshot provenance

These are the only raster assets approved for publication. Both were captured from the actual LocalGPT UI using `tools/gallery_demo.py --preview`, a fresh disposable database and synthetic seed data. The response is authored demo text; the six gallery images are deterministic shapes produced by `synthetic_image.py`. No LM Studio/ComfyUI calls, personal conversations, uploads, avatar or browser profile were used.

| File | Viewport | View |
| --- | --- | --- |
| `workspace.png` | 1280 × 840 | Light theme, English, expanded sidebar, “A weekend with room to wander” chat |
| `gallery.png` | 1280 × 720 | Light theme, English, collapsed sidebar, six synthetic images |

The PNG files contain only `IHDR`, `IDAT` and `IEND` chunks: no EXIF or text metadata. They are direct page captures, without browser chrome, compositing, image editing or personal-data redaction. Captured against application version 0.2.1; directory/documentation cleanup does not change its interface.

## Reproduce and refresh

1. Install the pinned environment with `.venv/bin/python tools/validate.py --setup`.
2. Build with `.venv/bin/python work/chat-sidebar/build.py` and start `.venv/bin/python tools/gallery_demo.py --preview --port 8194` on an available local port.
3. Open the demo in a fresh, isolated browser context. Select English and light appearance. Open the named chat with the sidebar expanded and Chat mode selected; capture at 1280 × 840.
4. Open Gallery, collapse the sidebar and capture at 1280 × 720. Wait for image decode and fade-in to finish. Do not capture errors, loading states or tooltips.
5. Save draft captures under ignored `output/playwright/`, inspect every pixel and PNG metadata, and obtain independent review before copying the approved pair here. Stop only the owned demo process afterward.
6. Add the new exact SHA-256 values to `APPROVED_SCREENSHOTS` in `tools/audit_source.py`; retain earlier approved hashes for historical scans. Run the source/index and full-history audits plus their negative controls.

Other screenshots and real generated media remain excluded from the repository. Do not approve arbitrary images merely by adding a hash.
