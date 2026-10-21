# Round 4 reference and implementation contract

Observed in the existing signed-in Safari session on 2026-10-21; only UI
geometry/controls were queried, not conversation or Memory text. Reference
images remain local and are cropped to navigation controls.

| Component | Observed rendered values / behavior |
|---|---|
| Rail | 52 px; Home at (8,8), 36×36, radius10, SVG20 |
| Pinned history | x52, width288; top-left/bottom-left radius16, overflow hidden |
| Panel header | x68,y8,width266,height36; collapse x294,y8,36×36,radius8 |
| New chat | full-width row beneath panel header; not a second permanent rail icon |
| Home | click opens temporary panel; clicking elsewhere including Inspector dismisses it; independent toggle pins it |
| Profile menu | width228, radius16, padding10; left49 (right of rail), bottom7 at 1443×998; avatar trigger36×36 |
| Settings | full page navigation to /settings/general-settings; Personalization → saved memories |
| Saved memories | centered680×800 at viewport1443×998; radius24; available-height constrained to458 at inspector viewport498 |
| Memory heading |20px,600,line28; 20px horizontal inset |
| Memory row action |32×32,radius8; close24×24,radius4 |
| Search input text |14px,400,line20 |

Hover trigger latency could not be isolated with the native tool's available
pointer actions (it has drag but no mouse-move API). No exact timing match is
claimed. HanzAgent uses immediate pointer entry and explicit pin/dismiss as a
reversible adaptation. Motion140ms is an app choice, not a measured reference.
Unused ChatGPT services and account/billing entries are omitted. Memory retains
HanzAgent categories and explicit capture preferences. Settings contains local
service diagnostics instead of cloud account controls. Safari developer features
were temporarily enabled with existing permission and restored to off.

## Delivery and reliability changes

At investigation time ports8190/8191 had no listener; ComfyUI8188 and LM Studio1234
were running. Restarting the UI process restored HTTP200 and repeated reloads.
SQLite integrity was `ok`. The previous launch command tied serve.py to its terminal,
and the frontend labeled unrelated failures as database disconnection. The precise
termination event from the user's original incident is unavailable. The new detached
launcher, separate SQLite health route, local path cache and retry/error categories
address the observed deployment failure without rebuilding user data.

Gallery removal is recoverable Trash. Permanent media deletion requires confirmation
and refuses all surviving chat/draft/Trash references. Chat purge defaults to keeping
generated files; optional file deletion retains shared assets and uploaded inputs.
Only registered uploads can be deleted from Local services. Failed unlinks keep a
durable retry journal. Explicit migration/safety backups and legacy JSON are disclosed
in diagnostics and are not silently erased; external snapshots are outside app control.

New output filenames include a unique suffix so ComfyUI counter reuse cannot collide
with a permanently deleted path. The installed Comfy writer must receive the same
Store/generation modules and restart before release. Old deletion routes reject
upgraded databases rather than bypassing the new lifecycle.

Cloud module: Axel session14800463, task bc-e9bdb6e0-e091-51d5-912f-030e5fec1aaa,
model composer-2.5, fast=false (provider serialized string), no reasoning parameter,
usage UNKNOWN. PR#8 head5293bf7e22706da8de532d6f2babe00c7c415233 supplied
Settings/Memory. Codex integrated it and repaired search focus, menu disposal,
viewport bounds, close guards and local diagnostics before acceptance.

Synthetic checks:47 Python tests; navigation/theme/error recovery browser matrix;
Memory add/edit/search/confirmation; Gallery Trash/restore/shared-file rejection/
permanent404; upload registration/reference guard/permanent404. Screenshots and
private-service receipts stay under ignored output/. New SVG is original vector
geometry, not a redistributed official brand asset.
